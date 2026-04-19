param(
  [string]$Source = "icon.png"
)

# Re-renders the Carboknot brand mark from the original portrait source PNG
# into clean, transparent-background, square icons.
#
#   1. Load source (24bppRgb, portrait).
#   2. Promote to 32bppArgb and chroma-key near-black pixels to fully transparent.
#   3. Crop to the bounding box of the visible mark.
#   4. For each target size, scale-to-fit on a transparent square canvas (no
#      stretching, preserves aspect ratio).

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$srcPath = Join-Path $root $Source
if (-not (Test-Path $srcPath)) {
  throw "Source not found: $srcPath"
}

$src = [System.Drawing.Image]::FromFile($srcPath)
Write-Host "Source: $($src.Width) x $($src.Height)  format=$($src.PixelFormat)"

# 1. Promote to 32-bit ARGB so we can write alpha.
$argb = New-Object System.Drawing.Bitmap($src.Width, $src.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($argb)
$g.DrawImage($src, 0, 0, $src.Width, $src.Height)
$g.Dispose()
$src.Dispose()

# 2. Chroma-key near-black to transparent using LockBits for speed.
$rect = New-Object System.Drawing.Rectangle(0, 0, $argb.Width, $argb.Height)
$data = $argb.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($data.Stride * $data.Height)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

$threshold = 28   # any channel <= this counts as "black-ish"
$soft = 70        # softer ramp for nicer edges
$minX = $argb.Width; $minY = $argb.Height; $maxX = -1; $maxY = -1

for ($y = 0; $y -lt $data.Height; $y++) {
  $row = $y * $data.Stride
  for ($x = 0; $x -lt $data.Width; $x++) {
    $i = $row + ($x * 4)
    $b = $bytes[$i]
    $g2 = $bytes[$i + 1]
    $r = $bytes[$i + 2]
    $maxc = [Math]::Max($r, [Math]::Max($g2, $b))
    if ($maxc -le $threshold) {
      $bytes[$i + 3] = 0   # fully transparent
    } elseif ($maxc -lt $soft) {
      # ramp alpha for anti-aliased edges
      $a = [int](255 * ($maxc - $threshold) / ($soft - $threshold))
      $bytes[$i + 3] = [byte]$a
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    } else {
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$argb.UnlockBits($data)

if ($maxX -lt 0) { throw "No visible pixels found after chroma-keying." }
Write-Host ("Bounding box: ({0},{1}) - ({2},{3})  size {4}x{5}" -f $minX, $minY, $maxX, $maxY, ($maxX - $minX + 1), ($maxY - $minY + 1))

# 3. Crop to bounding box (with a small breathing-room margin).
$pad = 12
$cx = [Math]::Max(0, $minX - $pad)
$cy = [Math]::Max(0, $minY - $pad)
$cw = [Math]::Min($argb.Width - $cx, ($maxX - $minX + 1) + ($pad * 2))
$ch = [Math]::Min($argb.Height - $cy, ($maxY - $minY + 1) + ($pad * 2))
$cropRect = New-Object System.Drawing.Rectangle($cx, $cy, $cw, $ch)
$cropped = $argb.Clone($cropRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$argb.Dispose()
Write-Host "Cropped to: $($cropped.Width) x $($cropped.Height)"

# Save the cleaned, cropped master.
$masterPath = Join-Path $root "logo-master.png"
$cropped.Save($masterPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Master: $masterPath"

# 4. Render each target size on a transparent square canvas, scale-to-fit.
$sizes = 16, 32, 48, 128, 192, 512
foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gg = [System.Drawing.Graphics]::FromImage($bmp)
  $gg.Clear([System.Drawing.Color]::Transparent)
  $gg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $gg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  $scale = [Math]::Min($size / $cropped.Width, $size / $cropped.Height)
  $targetW = [int]([Math]::Round($cropped.Width * $scale))
  $targetH = [int]([Math]::Round($cropped.Height * $scale))
  $offsetX = [int](($size - $targetW) / 2)
  $offsetY = [int](($size - $targetH) / 2)

  $gg.DrawImage($cropped, $offsetX, $offsetY, $targetW, $targetH)
  $gg.Dispose()

  $out = Join-Path $root ("icon-{0}.png" -f $size)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "Wrote $out  ($targetW x $targetH centered in $size x $size)"
}

$cropped.Dispose()
Write-Host "Done."
