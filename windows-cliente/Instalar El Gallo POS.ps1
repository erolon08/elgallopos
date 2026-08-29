# Instala un acceso directo en el Escritorio para abrir El Gallo POS
# como una app (sin barra de direcciones ni pestañas), apuntando a la
# PC donde corre el servidor a través de Tailscale.
#
# No hace falta ser administrador: el acceso directo se crea en el
# Escritorio del usuario actual.

$ip = "100.110.0.108"
$puerto = "3000"
$url = "http://${ip}:${puerto}"

$carpetaScript = Split-Path -Parent $MyInvocation.MyCommand.Path
$icono = Join-Path $carpetaScript "ElGalloPOS.ico"

if (-not (Test-Path $icono)) {
    Write-Host "No se encontró ElGalloPOS.ico en esta misma carpeta. Tiene que estar junto a este script."
    pause
    exit 1
}

# Busca un navegador instalado que soporte modo "app" (Chrome primero, Edge como respaldo).
$candidatos = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$navegador = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $navegador) {
    Write-Host "No se encontró Google Chrome ni Microsoft Edge instalado en esta PC."
    Write-Host "Instalá uno de los dos y volvé a correr este instalador."
    pause
    exit 1
}

$escritorio = [Environment]::GetFolderPath("Desktop")
$rutaAcceso = Join-Path $escritorio "El Gallo POS.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$acceso = $WshShell.CreateShortcut($rutaAcceso)
$acceso.TargetPath = $navegador
$acceso.Arguments = "--app=$url"
$acceso.IconLocation = $icono
$acceso.Description = "El Gallo POS"
$acceso.WorkingDirectory = Split-Path $navegador
$acceso.Save()

Write-Host ""
Write-Host "Listo. Se creo el acceso directo 'El Gallo POS' en el Escritorio."
Write-Host "Abre: $url"
Write-Host ""
Write-Host "Importante: esta PC tiene que estar conectada a Tailscale (icono al lado del reloj, en verde/conectado) para poder entrar."
pause
