function Log-Info($msg) { Write-Output "[INFO] $msg" }
function Log-Error($msg) { Write-Output "[ERROR] $msg" }

# пути к файлам
$certPath = $PSScriptRoot   # текущая папка скрипта
$keyFile = "$certPath\localhost-key.pem"
$certFile = "$certPath\localhost.pem"
$pfxFile = "$certPath\localhost.pfx"
$configFile = "$certPath\openssl-san.cnf"

# путь к openssl
$opensslPath = "C:\Program Files\Git\usr\bin\openssl.exe"

# пароль для PFX
$pfxPassword = "1234"

# существует ли openssl
if (-not (Test-Path $opensslPath)) {
    Log-Error "OpenSSL not found at path '$opensslPath'. Please install OpenSSL or fix the path."
    exit 1
}

# проверка наличия сертификатов
if ((-not (Test-Path $keyFile)) -or (-not (Test-Path $certFile)) -or (-not (Test-Path $pfxFile))) {

    # локальный IPv4 адрес
    $ipv4 = (Get-NetIPAddress -AddressFamily IPv4 |
             Where-Object { $_.PrefixOrigin -ne "WellKnown" -and $_.IPAddress -notlike "169.*" })[0].IPAddress

    # создать openssl config с SAN
    @"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext

[dn]
CN = localhost

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = $ipv4
"@ | Set-Content -Path $configFile

    # генерация приватного ключа
    if (-not (Test-Path $keyFile)) {
        & $opensslPath genrsa -out $keyFile 2048
    }

    # генерация самоподписанного сертификата с SAN
    & $opensslPath req -new -x509 -key $keyFile -out $certFile -days 365 -config $configFile -extensions req_ext

    # генерация PFX
    & $opensslPath pkcs12 -export -out $pfxFile -inkey $keyFile -in $certFile -password pass:$pfxPassword

    # установка PFX в LocalMachine\Trusted Root Certification Authorities
    try {
        $securePassword = ConvertTo-SecureString -String $pfxPassword -Force -AsPlainText
        Import-PfxCertificate -FilePath $pfxFile -CertStoreLocation Cert:\LocalMachine\Root -Password $securePassword
        Log-Info "Certificate successfully installed in LocalMachine\Trusted Root Certification Authorities"
    } catch {
        Log-Error "Failed to install the certificate. Make sure the script is running as Administrator. Error: $_"
        exit 1 # возврат ошибки, затем проверка на neq (not equal)
    }

} else {
    Log-Info "Certificates already exist, generation is not required."
}
