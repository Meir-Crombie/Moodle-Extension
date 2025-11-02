param(
	[string]$OutDir = "../icons"
)

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

# Ensure output directory exists
$fullOut = (Resolve-Path -Path (Join-Path $PSScriptRoot $OutDir)).Path
if (-not (Test-Path $fullOut)) {
	New-Item -ItemType Directory -Path $fullOut | Out-Null
}

# Colors
$bg = [System.Drawing.Color]::FromArgb(255, 37, 99, 235)  # blue 600
$fg = [System.Drawing.Color]::White

# Font
function Get-Font {
	param([int]$size)
	try {
		return New-Object System.Drawing.Font("Segoe UI Semibold", $size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
	} catch {
		return New-Object System.Drawing.Font("Arial", $size, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
	}
}

$Sizes = @(16,32,48,128)
foreach ($s in $Sizes) {
	$bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$g = [System.Drawing.Graphics]::FromImage($bmp)
	$g.SmoothingMode = 'AntiAlias'
	$g.Clear([System.Drawing.Color]::Transparent)

	# Rounded rect background
	$radius = [Math]::Max(3, [Math]::Floor($s * 0.24))
	$rect = New-Object System.Drawing.Rectangle(0,0,$s,$s)
	$path = New-Object System.Drawing.Drawing2D.GraphicsPath
	$path.AddArc(0,0,$radius,$radius,180,90)
	$path.AddArc($s-$radius,0,$radius,$radius,270,90)
	$path.AddArc($s-$radius,$s-$radius,$radius,$radius,0,90)
	$path.AddArc(0,$s-$radius,$radius,$radius,90,90)
	$path.CloseFigure()
	$bgBrush = New-Object System.Drawing.SolidBrush($bg)
	$g.FillPath($bgBrush, $path)
	$bgBrush.Dispose()
	$path.Dispose()

	# Letter M
	$fontSize = [Math]::Floor($s * 0.56)
	$font = Get-Font -size $fontSize
	$str = "M"
	$sf = New-Object System.Drawing.StringFormat
	$sf.Alignment = 'Center'
	$sf.LineAlignment = 'Center'
	$fgBrush = New-Object System.Drawing.SolidBrush($fg)
	$g.DrawString($str, $font, $fgBrush, ($s/2), ($s/2), $sf)
	$fgBrush.Dispose(); $sf.Dispose(); $font.Dispose()

	# Save
	$outPath = Join-Path $fullOut ("icon{0}.png" -f $s)
	$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
	$g.Dispose(); $bmp.Dispose()
	Write-Host "Generated $outPath"
}

Write-Host "Done. Icons saved to $fullOut"


