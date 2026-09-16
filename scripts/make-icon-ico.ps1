# Génère build/icon.ico (multi-tailles, entrées PNG) depuis apps/mobile/assets/icon.png
# — évite la conversion WASM d'electron-builder qui manque de mémoire sur une machine modeste.
Add-Type -AssemblyName System.Drawing

$root = 'C:\Users\Marianne\.zcode\workspace\default\synapse\123Ecriture'
$source = Join-Path $root 'apps\mobile\assets\icon.png'
$outDir = Join-Path $root 'apps\desktop\build'
$outFile = Join-Path $outDir 'icon.ico'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$src = [System.Drawing.Image]::FromFile($source)
$entries = @()

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gfx.DrawImage($src, 0, 0, $size, $size)
    $gfx.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $entries += ,@($size, $ms.ToArray())
    $bmp.Dispose()
    $ms.Dispose()
}
$src.Dispose()

# ICONDIR : 6 octets, puis ICONDIRENTRY (16 octets) par image, puis les données PNG.
$stream = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)                    # reserved
$writer.Write([UInt16]1)                    # type = ICO
$writer.Write([UInt16]$entries.Count)

$offset = 6 + 16 * $entries.Count
foreach ($entry in $entries) {
    $size = $entry[0]
    $data = $entry[1]
    $writer.Write([Byte]($(if ($size -ge 256) { 0 } else { $size })))  # width (0 = 256)
    $writer.Write([Byte]($(if ($size -ge 256) { 0 } else { $size })))  # height
    $writer.Write([Byte]0)                 # palette
    $writer.Write([Byte]0)                 # reserved
    $writer.Write([UInt16]1)               # color planes
    $writer.Write([UInt16]32)              # bits per pixel
    $writer.Write([UInt32]$data.Length)
    $writer.Write([UInt32]$offset)
    $offset += $data.Length
}
foreach ($entry in $entries) {
    $writer.Write($entry[1])
}
$writer.Flush()

[System.IO.File]::WriteAllBytes($outFile, $stream.ToArray())
$writer.Dispose()
$stream.Dispose()
Write-Output ('icon.ico écrit : ' + (Get-Item $outFile).Length + ' octets, ' + $entries.Count + ' tailles')
