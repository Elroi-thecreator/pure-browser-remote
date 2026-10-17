Add-Type -AssemblyName System.Drawing

$extensionPath = "e:\remoteControl\pure-browser-remote\extension"
$iconsDir = Join-Path $extensionPath "icons"
if (-not (Test-Path $iconsDir)) {
    New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null
}

$sizes = @(16, 48, 128)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $margin = [Math]::Max(1, [int]($size * 0.06))
    $rectWidth = $size - (2 * $margin)
    $rectHeight = $size - (2 * $margin)
    $radius = [Math]::Max(2, [int]($size * 0.22))

    $rect = New-Object System.Drawing.Rectangle $margin, $margin, $rectWidth, $rectHeight
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()

    $pt1 = New-Object System.Drawing.PointF 0, 0
    $pt2 = New-Object System.Drawing.PointF $size, $size
    $c1 = [System.Drawing.Color]::FromArgb(255, 37, 99, 235)
    $c2 = [System.Drawing.Color]::FromArgb(255, 14, 165, 233)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $pt1, $pt2, $c1, $c2
    $g.FillPath($brush, $path)

    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 255, 255, 255), [Math]::Max(1, [int]($size * 0.03)))
    $g.DrawPath($pen, $path)

    # Clean cursor arrow
    $p1 = New-Object System.Drawing.PointF ([float]($size * 0.30)), ([float]($size * 0.22))
    $p2 = New-Object System.Drawing.PointF ([float]($size * 0.72)), ([float]($size * 0.52))
    $p3 = New-Object System.Drawing.PointF ([float]($size * 0.54)), ([float]($size * 0.56))
    $p4 = New-Object System.Drawing.PointF ([float]($size * 0.66)), ([float]($size * 0.80))
    $p5 = New-Object System.Drawing.PointF ([float]($size * 0.52)), ([float]($size * 0.84))
    $p6 = New-Object System.Drawing.PointF ([float]($size * 0.42)), ([float]($size * 0.60))
    $p7 = New-Object System.Drawing.PointF ([float]($size * 0.30)), ([float]($size * 0.74))

    $arrowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $arrowPath.AddPolygon([System.Drawing.PointF[]]@($p1, $p2, $p3, $p4, $p5, $p6, $p7))

    $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillPath($whiteBrush, $arrowPath)

    $shadowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 15, 23, 42), [Math]::Max(1, [int]($size * 0.02)))
    $g.DrawPath($shadowPen, $arrowPath)

    $outputPath = Join-Path $iconsDir "icon-$size.png"
    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated $outputPath"
}
