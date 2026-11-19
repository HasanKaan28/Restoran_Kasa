# One-time setup of Restoran Kasa's Android release key.
#
# Creates a new signing key (PKCS12, RSA 4096, valid 30 years) with a random password, stores it
# as the four GitHub secrets the release workflow reads, and keeps a backup copy of the key and its
# password in Documents\Restoran-Kasa-imza. Every future APK must be signed with this same key, or
# phones cannot install the update over the old app: keep the backup safe (password manager, USB).
#
# Run it yourself, once, from the repository folder:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-android-signing.ps1
# It refuses to run when the secrets already exist, so it never replaces a key in use.

$ErrorActionPreference = 'Stop'
$repo = 'HasanKaan28/Restoran_Kasa'
$alias = 'restorankasa'

function Find-OpenSsl {
    $cmd = Get-Command openssl -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($root in @("$env:ProgramFiles\Git", "$env:LOCALAPPDATA\Programs\Git")) {
        $path = Join-Path $root 'mingw64\bin\openssl.exe'
        if (Test-Path $path) { return $path }
    }
    throw 'openssl bulunamadı. Git for Windows kurulu olmalı.'
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) bulunamadı.' }
$existing = (gh secret list --repo $repo) -join "`n"
if ($existing -match 'ANDROID_KEYSTORE_BASE64') {
    throw 'Android imza anahtarı zaten kayıtlı. Değiştirmek eski uygulamanın güncellenmesini bozar; durduruldu.'
}

$backup = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Restoran-Kasa-imza'
if ((Test-Path $backup) -and (Get-ChildItem $backup -Force | Select-Object -First 1)) {
    throw "Yedek klasörü boş değil: $backup. Önce içine bakın; üzerine yazılmadı."
}
New-Item -ItemType Directory -Force $backup | Out-Null

# 32 random letters and digits.
$chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

$openssl = Find-OpenSsl
$work = Join-Path $env:TEMP ("rk-sign-" + [guid]::NewGuid())
New-Item -ItemType Directory $work | Out-Null
try {
    $key = Join-Path $work 'key.pem'
    $cert = Join-Path $work 'cert.pem'
    $p12 = Join-Path $backup 'restoran-kasa-release.p12'
    # openssl writes progress dots to stderr; Windows PowerShell 5.1 turns that into a terminating
    # error under 'Stop', so the native calls run under 'Continue' and are judged by exit code.
    $ErrorActionPreference = 'Continue'
    & $openssl req -x509 -newkey rsa:4096 -sha256 -days 10950 -nodes -keyout $key -out $cert `
        -subj '/CN=Restoran Kasa/O=Restoran Kasa/C=TR' 2>&1 | Out-Null
    $reqExit = $LASTEXITCODE
    $env:RK_SIGN_PASS = $password
    if ($reqExit -eq 0) {
        & $openssl pkcs12 -export -inkey $key -in $cert -name $alias -out $p12 -passout env:RK_SIGN_PASS 2>&1 | Out-Null
    }
    $p12Exit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($reqExit -ne 0) { throw 'Anahtar üretilemedi (openssl req).' }
    if ($p12Exit -ne 0 -or -not (Test-Path $p12)) { throw 'Anahtar dosyası yazılamadı (openssl pkcs12).' }
} finally {
    Remove-Item Env:RK_SIGN_PASS -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($p12))
gh secret set ANDROID_KEYSTORE_BASE64 --repo $repo --body $base64
gh secret set ANDROID_KEYSTORE_PASSWORD --repo $repo --body $password
gh secret set ANDROID_KEY_ALIAS --repo $repo --body $alias
gh secret set ANDROID_KEY_PASSWORD --repo $repo --body $password

@"
Restoran Kasa Android imza anahtarı ($(Get-Date -Format 'yyyy-MM-dd'))

Dosya: restoran-kasa-release.p12
Takma ad (alias): $alias
Şifre (anahtar ve dosya için aynı): $password

Bu klasörü güvenli bir yere kopyalayın (şifre yöneticisi, USB bellek). Anahtar kaybolursa
telefonlardaki uygulama güncellenemez; yeni anahtarla kurulan uygulama eskisinin verisini göremez.
Bu klasörü kimseyle paylaşmayın ve depoya eklemeyin.
"@ | Set-Content -Encoding utf8 (Join-Path $backup 'BENI-OKU.txt')

Write-Host ''
Write-Host 'Tamam: dört GitHub secret kaydedildi.' -ForegroundColor Green
Write-Host "Yedek: $backup (anahtar ve şifre). Güvenli bir yere kopyalayın."
gh secret list --repo $repo
