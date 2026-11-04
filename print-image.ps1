# PowerShell .NET print helper for images with explicit color/monochrome choice,
# N-up layout (CopiesPerPage = 1,2,4,6,9), duplex (both-side) option, and total copies.
param(
  [Parameter(Mandatory=$true)][string]$FilePath,
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$false)][string]$Color = "true",
  [Parameter(Mandatory=$false)][int]$CopiesPerPage = 1,
  [Parameter(Mandatory=$false)][string]$Duplex = "false",
  [Parameter(Mandatory=$false)][int]$Copies = 1
)
$ErrorActionPreference = "Stop"
$isColor = ($Color -eq "true" -or $Color -eq "1")
$doDuplex = ($Duplex -eq "true" -or $Duplex -eq "1")
if ($CopiesPerPage -lt 1) { $CopiesPerPage = 1 }
if ($Copies -lt 1) { $Copies = 1 }

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
$img = [System.Drawing.Image]::FromFile($FilePath)
try {
  for ($copy = 1; $copy -le $Copies; $copy++) {
    $doc = New-Object System.Drawing.Printing.PrintDocument
    $doc.PrinterSettings.PrinterName = $PrinterName
    $doc.DefaultPageSettings.Color   = $isColor
    if ($doDuplex) { $doc.PrinterSettings.Duplex = [System.Drawing.Printing.Duplex]::Default }
    else { $doc.PrinterSettings.Duplex = [System.Drawing.Printing.Duplex]::Simplex }
    $doc.add_PrintPage({
      param($sender, $e)
      $pw = $e.PageBounds.Width
      $ph = $e.PageBounds.Height
      $grid = GridFor $CopiesPerPage
      $cols = $grid[0]; $rows = $grid[1]
      $gap = 12
      $cellW = ($pw - $gap*($cols+1)) / $cols
      $cellH = ($ph - $gap*($rows+1)) / $rows
      $drawn = 0
      for ($r=0; $r -lt $rows; $r++) {
        for ($c=0; $c -lt $cols; $c++) {
          if ($drawn -ge $CopiesPerPage) { break }
          $x0 = $gap + $c*($cellW+$gap)
          $y0 = $gap + $r*($cellH+$gap)
          $scale = [Math]::Min($cellW / $img.Width, $cellH / $img.Height)
          $w = [int]($img.Width  * $scale)
          $h = [int]($img.Height * $scale)
          $x = [int]($x0 + ($cellW-$w)/2)
          $y = [int]($y0 + ($cellH-$h)/2)
          $e.Graphics.DrawImage($img, $x, $y, $w, $h)
          $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::LightGray)
          $e.Graphics.DrawRectangle($pen, $x0, $y0, [int]$cellW, [int]$cellH)
          $pen.Dispose()
          $drawn++
        }
      }
      $e.HasMorePages = $false
    })
    $doc.Print()
  }
  Write-Output "OK: printed $FilePath to $PrinterName (color=$isColor, copiesPerPage=$CopiesPerPage, duplex=$doDuplex, copies=$Copies)"
} finally {
  $img.Dispose()
}
