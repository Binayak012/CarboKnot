// Reusable swipeable tile carousel.
//
// CSS scroll-snap based — works with native touch swipe, mouse drag (via
// browser inertial scroll), keyboard arrows on the prev/next buttons, and
// click-on-dot navigation. No external dep.

import {
  Children,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CarouselProps {
  children: ReactNode;
  /** How many slides should be visible at once (1 = one full-width per page). */
  slidesPerView?: 1 | 2 | 3 | 4;
  /** Same as slidesPerView but for screens < 768px. */
  slidesPerViewMobile?: 1 | 2;
  /** Pixel gap between slides. */
  gap?: number;
  /** Optional eyebrow / kicker shown above the controls. */
  eyebrow?: ReactNode;
  /** Optional aria label for the scrolling region. */
  ariaLabel?: string;
  /** Hide the dot indicator. */
  hideDots?: boolean;
  /** Hide the prev / next arrow buttons. */
  hideArrows?: boolean;
  /** Render arrows as soft circular overlays floating on the left/right edges
   *  of the slides instead of in the header. Useful for hero carousels. */
  overlayArrows?: boolean;
  /** Wrap around: prev from slide 0 jumps to last; next from last jumps to 0. */
  loop?: boolean;
  /** Extra classes for the outer wrapper. */
  className?: string;
}

export function Carousel({
  children,
  slidesPerView = 1,
  slidesPerViewMobile = 1,
  gap = 12,
  eyebrow,
  ariaLabel,
  hideDots = false,
  hideArrows = false,
  overlayArrows = false,
  loop = false,
  className = ''
}: CarouselProps) {
  const slides = useMemo(() => Children.toArray(children), [children]);
  const total = slides.length;

  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [perView, setPerView] = useState<number>(slidesPerView);

  // Track viewport so slidesPerView gracefully steps down on small screens.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () =>
      setPerView(mq.matches ? slidesPerViewMobile : slidesPerView);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [slidesPerView, slidesPerViewMobile]);

  const totalPages = Math.max(1, Math.ceil(total / perView));

  const scrollToIndex = useCallback(
    (idx: number) => {
      const el = trackRef.current;
      if (!el) return;
      const target = el.children[idx * perView] as HTMLElement | undefined;
      if (!target) return;
      el.scrollTo({
        left: target.offsetLeft - el.offsetLeft,
        behavior: 'smooth'
      });
    },
    [perView]
  );

  const handleScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el || total === 0) return;
    const slideWidth = el.scrollWidth / total;
    if (slideWidth <= 0) return;
    const rawIndex = el.scrollLeft / slideWidth;
    const page = Math.round(rawIndex / perView);
    setActiveIndex(Math.min(totalPages - 1, Math.max(0, page)));
  }, [perView, total, totalPages]);

  const slideBasis = `calc((100% - ${(perView - 1) * gap}px) / ${perView})`;
  const showControls = total > perView;

  const goPrev = useCallback(() => {
    if (loop) {
      scrollToIndex((activeIndex - 1 + totalPages) % totalPages);
    } else {
      scrollToIndex(Math.max(0, activeIndex - 1));
    }
  }, [activeIndex, loop, scrollToIndex, totalPages]);

  const goNext = useCallback(() => {
    if (loop) {
      scrollToIndex((activeIndex + 1) % totalPages);
    } else {
      scrollToIndex(Math.min(totalPages - 1, activeIndex + 1));
    }
  }, [activeIndex, loop, scrollToIndex, totalPages]);

  const prevDisabled = !loop && activeIndex === 0;
  const nextDisabled = !loop && activeIndex >= totalPages - 1;

  return (
    <div
      className={`carousel-root ${className}`}
      data-slides={total}
      data-per-view={perView}
    >
      {(eyebrow || (showControls && !hideArrows && !overlayArrows)) && (
        <div className="carousel-header">
          <div className="carousel-eyebrow">{eyebrow}</div>
          {showControls && !hideArrows && !overlayArrows && (
            <div className="carousel-arrows">
              <button
                type="button"
                className="carousel-arrow"
                onClick={goPrev}
                disabled={prevDisabled}
                aria-label="Previous slide"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                className="carousel-arrow"
                onClick={goNext}
                disabled={nextDisabled}
                aria-label="Next slide"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="carousel-stage">
        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="carousel-track"
          style={{ gap: `${gap}px` }}
          aria-label={ariaLabel}
          role="region"
        >
          {slides.map((child, i) => (
            <div
              key={i}
              className="carousel-slide"
              style={{ flexBasis: slideBasis, maxWidth: slideBasis }}
            >
              {child}
            </div>
          ))}
        </div>

        {overlayArrows && showControls && !hideArrows && (
          <>
            <button
              type="button"
              className="carousel-overlay-arrow carousel-overlay-arrow-left"
              onClick={goPrev}
              disabled={prevDisabled}
              aria-label="Previous slide"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              className="carousel-overlay-arrow carousel-overlay-arrow-right"
              onClick={goNext}
              disabled={nextDisabled}
              aria-label="Next slide"
            >
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>

      {!hideDots && showControls && (
        <div
          className="carousel-dots"
          role="tablist"
          aria-label={ariaLabel ? `${ariaLabel} pages` : 'Carousel pages'}
        >
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => scrollToIndex(i)}
              className={`carousel-dot ${
                i === activeIndex ? 'carousel-dot-active' : ''
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
