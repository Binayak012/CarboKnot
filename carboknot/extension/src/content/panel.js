// Carboknot — interpretability panel.
//
// Reads the computeCarbon result and renders the full trace on screen.
// No network calls. No mutation of the result object.
//
// Alternatives in the lower section come from engine/alternatives.js — a
// hardcoded constant table. The "Open" button link-outs are the ONLY
// network traffic this module can induce, and they happen by user click
// into a new tab, not from the content script itself.

import { getAlternatives } from '../engine/alternatives.js';
import { logEvent } from '../storage/db.js';

const PANEL_ID = 'carboknot-panel';

/**
 * @param {import('../engine/carbon.js').CarbonResult} result
 */
export function openPanel(result) {
  document.getElementById(PANEL_ID)?.remove();

  const panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Carbon breakdown');

  const category = result?.trace?.inputs?.category ?? result?.category ?? 'general';
  const originalPrice = Number(result?.trace?.inputs?.price) || 0;
  const alternatives = getAlternatives(category, result.kg_total);

  panel.append(
    renderCloseButton(() => panel.remove()),
    renderHeader(result),
    renderStageBars(result.stages),
    renderAccordion(result.trace),
    renderK2Explanation(result),
    renderAlternatives(alternatives, { originalKg: result.kg_total, originalPrice })
  );

  // Close with Escape for keyboard users.
  const onKey = (e) => {
    if (e.key === 'Escape') {
      panel.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(panel);
}

function renderCloseButton(onClose) {
  const btn = document.createElement('button');
  btn.className = 'carboknot-panel-close';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Close');
  btn.textContent = '×';
  btn.addEventListener('click', onClose);
  return btn;
}

function renderHeader(result) {
  const header = document.createElement('header');
  header.className = 'carboknot-panel-header';

  const title = document.createElement('div');
  title.className = 'carboknot-panel-title';
  title.textContent = 'Carbon breakdown';

  const total = document.createElement('div');
  total.className = 'carboknot-panel-total';
  total.textContent = `${result.kg_total.toFixed(1)} kg CO₂e`;

  const range = document.createElement('div');
  range.className = 'carboknot-panel-range';
  range.textContent =
    `Range: ${result.confidence.low.toFixed(1)} – ${result.confidence.high.toFixed(1)} kg` +
    ` · ±${result.confidence.width_pct.toFixed(0)}%`;

  header.append(title, total, range);

  if (result.category_uncertain) {
    const warn = document.createElement('div');
    warn.className = 'carboknot-panel-warn';
    warn.textContent = '⚠ Category uncertain — confidence interval widened.';
    header.appendChild(warn);
  }

  return header;
}

function renderStageBars(stages) {
  const section = document.createElement('section');
  section.className = 'carboknot-panel-bars';

  const values = Object.values(stages);
  const maxStage = values.length ? Math.max(...values) : 0;

  const order = ['manufacturing', 'shipping', 'packaging', 'end_of_life'];
  for (const name of order) {
    if (!(name in stages)) continue;
    const kg = stages[name];
    const pct = maxStage > 0 ? (kg / maxStage) * 100 : 0;

    const row = document.createElement('div');
    row.className = 'carboknot-bar-row';

    const label = document.createElement('span');
    label.className = 'carboknot-bar-label';
    label.textContent = name.replace(/_/g, ' ');

    const track = document.createElement('div');
    track.className = 'carboknot-bar-track';
    const fill = document.createElement('div');
    fill.className = 'carboknot-bar-fill';
    fill.style.width = `${pct.toFixed(0)}%`;
    track.appendChild(fill);

    const value = document.createElement('span');
    value.className = 'carboknot-bar-value';
    value.textContent = `${kg.toFixed(1)} kg`;

    row.append(label, track, value);
    section.appendChild(row);
  }
  return section;
}

function renderAccordion(trace) {
  const details = document.createElement('details');
  details.className = 'carboknot-panel-trace';
  details.open = true;

  const summary = document.createElement('summary');
  summary.textContent = 'How was this calculated?';
  details.appendChild(summary);

  // Source
  const sourceSec = document.createElement('div');
  sourceSec.className = 'carboknot-trace-section';
  const sourceLabel = document.createElement('strong');
  sourceLabel.textContent = 'Source: ';
  sourceSec.append(sourceLabel, document.createTextNode(trace?.lookup?.source ?? ''));
  details.appendChild(sourceSec);

  // Computation steps
  const compSec = document.createElement('div');
  compSec.className = 'carboknot-trace-section';
  const compLabel = document.createElement('strong');
  compLabel.textContent = 'Computation';
  compSec.appendChild(compLabel);
  const ol = document.createElement('ol');
  for (const step of trace?.computation ?? []) {
    const li = document.createElement('li');
    const code = document.createElement('code');
    code.textContent = String(step);
    li.appendChild(code);
    ol.appendChild(li);
  }
  compSec.appendChild(ol);
  details.appendChild(compSec);

  // Assumptions
  const asmSec = document.createElement('div');
  asmSec.className = 'carboknot-trace-section';
  const asmLabel = document.createElement('strong');
  asmLabel.textContent = 'Assumptions';
  asmSec.appendChild(asmLabel);
  const ul = document.createElement('ul');
  for (const a of trace?.assumptions ?? []) {
    const li = document.createElement('li');
    li.textContent = String(a);
    ul.appendChild(li);
  }
  asmSec.appendChild(ul);
  details.appendChild(asmSec);

  // Confidence reasoning.
  // Spec locator is `trace.confidence_reason` (flat). The current engine
  // emits `trace.confidence.reason` (nested). Read both shapes so the
  // panel is resilient to the engine's future fix.
  const reason =
    (trace && typeof trace.confidence_reason === 'string' && trace.confidence_reason) ||
    (trace && trace.confidence && typeof trace.confidence.reason === 'string' && trace.confidence.reason) ||
    '';

  const confSec = document.createElement('div');
  confSec.className = 'carboknot-trace-section';
  const confLabel = document.createElement('strong');
  confLabel.textContent = 'Confidence reasoning: ';
  confSec.append(confLabel, document.createTextNode(reason));
  details.appendChild(confSec);

  // Methodology stamp (muted footer of the accordion).
  if (trace?.methodology_version) {
    const ver = document.createElement('div');
    ver.className = 'carboknot-trace-version';
    ver.textContent = `Methodology version: ${trace.methodology_version}`;
    details.appendChild(ver);
  }

  return details;
}

// ------------------------------------------------------------------
// K2 Think V2 — "Why this footprint?"
// ------------------------------------------------------------------
//
// Climatiq + the local LCA engine produce a deterministic, peer-reviewed
// number. K2 Think V2 narrates WHY that number looks the way it does,
// grounded in the same trace already rendered above. It never revises
// kg_total, stages, or the confidence interval — those stay canonical.
// The network call is lazy: it only fires when the user expands the
// section. Fallback text renders synchronously so the UX never blocks.

function renderK2Explanation(result) {
  const details = document.createElement('details');
  details.className = 'carboknot-panel-trace carboknot-k2-section';

  const summary = document.createElement('summary');
  summary.textContent = 'Why this footprint? (K2 Think V2 reasoning)';
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'carboknot-trace-section';

  const text = document.createElement('p');
  text.className = 'carboknot-alt-rationale-text';
  text.textContent = 'Loading K2 Think V2 reasoning…';
  body.appendChild(text);

  const tag = document.createElement('span');
  tag.className = 'carboknot-alt-source-tag';
  tag.textContent = 'Pending';
  body.appendChild(tag);

  details.appendChild(body);

  let requested = false;
  const runOnce = () => {
    if (requested) return;
    requested = true;

    // Synchronous local fallback so the user sees something instantly.
    const localTop = topStage(result.stages);
    if (localTop) {
      text.textContent =
        `The ${localTop.name.replace(/_/g, ' ')} stage dominates (~${localTop.pct}% of the total), ` +
        `which is typical for the ${result.category} category. ` +
        `Confidence band: ±${result.confidence.width_pct.toFixed(0)}% — ` +
        `${result.trace?.confidence_reason || result.confidence.reason || ''}`.trim();
    }

    const payload = {
      title: result?.trace?.inputs?.title || '',
      price: Number(result?.trace?.inputs?.price) || 0,
      category: result.category,
      kg_total: result.kg_total,
      stages: result.stages,
      confidence: {
        low: result.confidence.low,
        high: result.confidence.high,
        width_pct: result.confidence.width_pct,
        reason: result.confidence.reason
      },
      confidence_reason: result.trace?.confidence_reason || result.confidence.reason || ''
    };

    try {
      chrome.runtime.sendMessage({ type: 'k2_reason', payload }, (resp) => {
        if (chrome.runtime.lastError) {
          tag.textContent = 'Local reasoning';
          return;
        }
        if (resp?.ok && resp.data?.explanation) {
          text.textContent = resp.data.explanation;
          tag.textContent = resp.data.source === 'k2_think_v2' ? 'K2 Think V2' : 'Local reasoning';
        } else {
          tag.textContent = 'Local reasoning';
        }
      });
    } catch (_) {
      tag.textContent = 'Local reasoning';
    }
  };

  // Kick off on first expand. If the <details> is already open (browser
  // restore), the toggle event still fires on first user interaction —
  // so also run immediately if `open` is already true at mount.
  details.addEventListener('toggle', () => {
    if (details.open) runOnce();
  });
  if (details.open) runOnce();

  return details;
}

function topStage(stages) {
  const entries = Object.entries(stages || {}).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return null;
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  let best = entries[0];
  for (const e of entries) if (e[1] > best[1]) best = e;
  return { name: best[0], pct: Math.round((best[1] / total) * 100) };
}

// ------------------------------------------------------------------
// Alternatives section
// ------------------------------------------------------------------

function fmtSignedUsd(delta) {
  const abs = Math.abs(delta);
  const s = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(2);
  if (delta < 0) return `–$${s}`;
  if (delta > 0) return `+$${s}`;
  return '±$0';
}

function fmtSignedKg(delta) {
  const abs = Math.abs(delta);
  if (delta < 0) return `–${abs.toFixed(1)} kg saved`;
  if (delta > 0) return `+${abs.toFixed(1)} kg more`;
  return '±0.0 kg';
}

function renderAlternatives(alternatives, { originalKg, originalPrice }) {
  const section = document.createElement('section');
  section.className = 'carboknot-alt-section';

  const header = document.createElement('div');
  header.className = 'carboknot-alt-header';
  header.textContent = 'Greener alternatives';
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'carboknot-alt-list';

  for (const alt of alternatives || []) {
    list.appendChild(renderAlternativeCard(alt, { originalKg, originalPrice }));
  }

  section.appendChild(list);
  return section;
}

function renderAlternativeCard(alt, { originalKg, originalPrice }) {
  const card = document.createElement('article');
  card.className = 'carboknot-alt-card';

  const row = document.createElement('div');
  row.className = 'carboknot-alt-row';

  const name = document.createElement('div');
  name.className = 'carboknot-alt-name';
  name.textContent = alt.name;

  const merchant = document.createElement('span');
  merchant.className = 'carboknot-alt-merchant';
  merchant.textContent = alt.merchant;

  row.append(name, merchant);

  const priceDelta = Number(alt.price_usd) - Number(originalPrice);
  const priceLine = document.createElement('div');
  priceLine.className = 'carboknot-alt-price';
  const priceVal = document.createElement('span');
  priceVal.textContent = `$${Number(alt.price_usd).toFixed(0)}`;
  const priceDeltaEl = document.createElement('span');
  priceDeltaEl.className =
    'carboknot-alt-delta ' +
    (priceDelta < 0 ? 'carboknot-alt-delta-good' : priceDelta > 0 ? 'carboknot-alt-delta-bad' : 'carboknot-alt-delta-flat');
  priceDeltaEl.textContent = ` (${fmtSignedUsd(priceDelta)})`;
  priceLine.append(priceVal, priceDeltaEl);

  const carbonDelta = Number(alt.carbon_kg) - Number(originalKg);
  const carbonLine = document.createElement('div');
  carbonLine.className = 'carboknot-alt-carbon';
  const carbonVal = document.createElement('span');
  carbonVal.textContent = `${Number(alt.carbon_kg).toFixed(1)} kg CO₂e`;
  const carbonDeltaEl = document.createElement('span');
  carbonDeltaEl.className =
    'carboknot-alt-delta ' +
    (carbonDelta < 0 ? 'carboknot-alt-delta-good' : carbonDelta > 0 ? 'carboknot-alt-delta-bad' : 'carboknot-alt-delta-flat');
  carbonDeltaEl.textContent = ` (${fmtSignedKg(carbonDelta)})`;
  carbonLine.append(carbonVal, carbonDeltaEl);

  const actions = document.createElement('div');
  actions.className = 'carboknot-alt-actions';

  const openBtn = document.createElement('a');
  openBtn.className = 'carboknot-alt-open-btn';
  openBtn.href = alt.url;
  openBtn.target = '_blank';
  openBtn.rel = 'noopener noreferrer';
  openBtn.textContent = 'Open';

  const whyBtn = document.createElement('button');
  whyBtn.type = 'button';
  whyBtn.className = 'carboknot-alt-why-btn';
  whyBtn.setAttribute('aria-expanded', 'false');
  whyBtn.textContent = 'Why is this lower carbon?';

  actions.append(openBtn, whyBtn);

  const drawer = document.createElement('div');
  drawer.className = 'carboknot-alt-rationale';
  drawer.hidden = true;

  const rationaleText = document.createElement('p');
  rationaleText.className = 'carboknot-alt-rationale-text';
  rationaleText.textContent = String(alt.rationale || '');

  const tag = document.createElement('span');
  tag.className = 'carboknot-alt-source-tag';
  tag.textContent = 'Local reasoning';

  drawer.append(rationaleText, tag);

  whyBtn.addEventListener('click', () => {
    const nowOpen = drawer.hidden;
    drawer.hidden = !nowOpen;
    whyBtn.setAttribute('aria-expanded', String(nowOpen));
    if (nowOpen) {
      // Audit-log the click. Contract: event_type only + timestamp,
      // no product title, no URL, no merchant, no price.
      Promise.resolve()
        .then(() => logEvent('alternative_rationale_viewed'))
        .catch(() => {});
    }
  });

  card.append(row, priceLine, carbonLine, actions, drawer);
  return card;
}
