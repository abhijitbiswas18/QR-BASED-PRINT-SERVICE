param(
  [Parameter(Mandatory=$true)][string]$InputImage,
  [Parameter(Mandatory=$false)][int]$CopiesPerPage = 1,
  [Parameter(Mandatory=$false)][string]$Quality = "normal",
  [Parameter(Mandatory=$false)][string]$PaperSize = "A4",
  [Parameter(Mandatory=$true)][string]$OutputPdf
)
$ErrorActionPreference = "Stop"
if ($CopiesPerPage -lt 1) { $CopiesPerPage = 1 }

function GridFor([int]$n) {
  switch ($n) {
    1 { return @(1,1) }
    2 { return @(1,2) }
    4 { return @(2,2) }
    6 { return @(2,3) }
    9 { return @(3,3) }
    default {
      $c = [Math]::Ceiling([Math]::Sqrt($n))
      return @($c,$c)
    }
  }
}

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($InputImage)
try {
  $pageW = 595
  $pageH = 842
  switch ($PaperSize.ToLower()) {
    "passport" { $pageW = 99; $pageH = 128 }
    "postcard" { $pageW = 432; $pageH = 288 }
    default { $pageW = 595; $pageH = 842 }
  }
  $bmp = New-Object System.Drawing.Bitmap $pageW, $pageH
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $grid = GridFor $CopiesPerPage
  $cols = $grid[0]; $rows = $grid[1]
  $gap = 12
  $cellW = ($pageW - $gap*($cols+1)) / $cols
  $cellH = ($pageH - $gap*($rows+1)) / $rows
  $drawn = 0
  for ($r=0; $r -lt $rows; $r++) {
    for ($c=0; $c -lt $cols; $c++) {
      if ($drawn -ge $CopiesPerPage) { break }
      $x0 = $gap + $c*($cellW+$gap)
      $y0 = $gap + $r*($cellH+$gap)
      $scale = [Math]::Min($cellW / $img.Width, $cellH / $img.Height)
      $w = [int]($img.Width * $scale)
      $h = [int]($img.Height * $scale)
      $x = [int]($x0 + ($cellW-$w)/2)
      $y = [int]($y0 + ($cellH-$h)/2)
      $g.DrawImage($img, $x, $y, $w, $h)
      $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::LightGray)
      $g.DrawRectangle($pen, $x0, $y0, [int]$cellW, [int]$cellH)
      $pen.Dispose()
      $drawn++
    }
  }
  $g.Dispose()

  $tmpJpeg = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), 'jpg')
  $jpegQuality = if ($Quality -eq "high") { 95L } else { 80L }
  $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
  $encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
  $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $jpegQuality
  $bmp.Save($tmpJpeg, $enc, $encParams)
  $bmp.Dispose()

  $jpegBytes = [System.IO.File]::ReadAllBytes($tmpJpeg)
  $iw = [System.Drawing.Image]::FromFile($tmpJpeg).Width
  $ih = [System.Drawing.Image]::FromFile($tmpJpeg).Height

  $content = "q`n$iw 0 0 $ih 0 0 cm`n/Img Do Q`n"
  $contentBytes = [System.Text.Encoding]::ASCII.GetBytes($content)

  $ms = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter($ms, [System.Text.Encoding]::ASCII)
  function wr($s){ $b=[System.Text.Encoding]::ASCII.GetBytes($s); $w.Write($b) }

  wr "%PDF-1.4`n"
  $off = @{}
  $off[1] = $ms.Position
  wr "1 0 obj`n<</Type/Catalog/Pages 2 0 R>>`nendobj`n"
  $off[2] = $ms.Position
  wr "2 0 obj`n<</Type/Pages/Kids[3 0 R]/Count 1>>`nendobj`n"
  $off[3] = $ms.Position
  wr "3 0 obj`n<</Type/Page/Parent 2 0 R/MediaBox[0 0 $iw $ih]/Resources<</XObject<</Img 4 0 R>>>>/Contents 5 0 R>>`nendobj`n"
  $off[4] = $ms.Position
  wr "4 0 obj`n<</Type/XObject/Subtype/Image/Width $iw/Height $ih/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length $($jpegBytes.Length)>>`nstream`n"
  $w.Write($jpegBytes)
  wr "`nendstream`nendobj`n"
  $off[5] = $ms.Position
  wr "5 0 obj`n<</Length $($contentBytes.Length)>>`nstream`n"
  $w.Write($contentBytes)
  wr "`nendstream`nendobj`n"

  $xrefOff = $ms.Position
  wr "xref`n0 6`n"
  wr "0000000000 65535 f `n"
  for ($i=1; $i -le 5; $i++) { wr ("{0:D10} 00000 n `n" -f $off[$i]) }
  wr "trailer`n<</Size 6/Root 1 0 R>>`nstartxref`n$xrefOff`n%%EOF`n"
  $w.Flush()
  $bytes = $ms.ToArray()
  $ms.Close()
  [System.IO.File]::WriteAllBytes($OutputPdf, $bytes)

  Remove-Item $tmpJpeg -Force -ErrorAction SilentlyContinue
  Write-Output "OK: preview pdf created: $OutputPdf ($iw x $ih)"
} finally {
  try { $img.Dispose() } catch {}
}
