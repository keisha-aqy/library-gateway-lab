$ErrorActionPreference = "Stop"

# Muat .env
Get-Content "$PSScriptRoot\..\.env" | ForEach-Object {
  if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)$') { Set-Item -Path "Env:$($Matches[1])" -Value $Matches[2] }
}

$Admin   = "http://localhost:9180/apisix/admin"
$Headers = @{ "X-API-KEY" = $env:APISIX_ADMIN_KEY }

# Potongan konfigurasi yang dipakai ulang
$cors = @{
  allow_origins = "http://localhost:5173"
  allow_methods = "GET,POST,PUT,DELETE,OPTIONS"
  allow_headers = "Authorization,Content-Type"
  max_age       = 3600
}
$oidc = @{
  client_id     = "apisix"
  client_secret = "apisix-secret"
  discovery     = "http://keycloak:8080/realms/library/.well-known/openid-configuration"
  bearer_only   = $true
  use_jwks      = $true
  ssl_verify    = $false
}
$limitPublic = @{ count = 20; time_window = 10; key = "remote_addr"; rejected_code = 429 }
$limitAuth   = @{ count = 60; time_window = 60; key = "remote_addr"; rejected_code = 429 }
$upstream    = @{ type = "roundrobin"; nodes = @{ "backend-1:3000" = 1; "backend-2:3000" = 1 } }

function Put-Route($id, $uris, $plugins) {
  $body = @{ uris = $uris; plugins = $plugins; upstream = $upstream } | ConvertTo-Json -Depth 10
  Invoke-RestMethod -Method Put -Uri "$Admin/routes/$id" -Headers $Headers `
    -ContentType "application/json" -Body $body | Out-Null
  Write-Host "Route $id OK"
}

Put-Route 1 @("/api/info", "/api/books", "/api/books/*") @{ "cors" = $cors; "limit-count" = $limitPublic }
Put-Route 2 @("/api/loans", "/api/loans/*")              @{ "cors" = $cors; "openid-connect" = $oidc; "limit-count" = $limitAuth }
Put-Route 3 @("/api/manage/*")                           @{ "cors" = $cors; "openid-connect" = $oidc; "limit-count" = $limitAuth }
Put-Route 4 @("/api/admin/*")                            @{ "cors" = $cors; "openid-connect" = $oidc; "limit-count" = $limitAuth }
Write-Host "Selesai."