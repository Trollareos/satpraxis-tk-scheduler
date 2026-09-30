$ErrorActionPreference = "Stop"
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = $null
$port = 0

foreach ($candidate in 8765..8775) {
    try {
        $attempt = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, [int]$candidate)
        $attempt.Start()
        $listener = $attempt
        $port = $candidate
        break
    }
    catch {
        if ($attempt) { $attempt.Stop() }
    }
}

if (-not $listener) {
    Write-Host "Could not find a free local port (8765-8775)." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

function Parse-Query([string]$query) {
    $result = @{}
    if (-not $query) { return $result }
    foreach ($part in $query.TrimStart('?').Split('&')) {
        if (-not $part) { continue }
        $pieces = $part.Split('=', 2)
        $key = [System.Uri]::UnescapeDataString($pieces[0].Replace('+', ' '))
        $value = if ($pieces.Length -gt 1) { [System.Uri]::UnescapeDataString($pieces[1].Replace('+', ' ')) } else { "" }
        $result[$key] = $value
    }
    return $result
}

function Send-Response($stream, [int]$status, [string]$contentType, [byte[]]$body) {
    $reason = switch ($status) {
        200 { "OK" }
        400 { "Bad Request" }
        404 { "Not Found" }
        405 { "Method Not Allowed" }
        502 { "Bad Gateway" }
        default { "Error" }
    }
    $headers = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}

function Send-Text($stream, [int]$status, [string]$message) {
    Send-Response $stream $status "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes($message))
}

function Download-Google([string]$url) {
    $client = New-Object System.Net.WebClient
    try {
        $client.Headers.Add("User-Agent", "Mozilla/5.0 SatpraxisLocalScheduler/1.0")
        return $client.DownloadData($url)
    }
    finally {
        $client.Dispose()
    }
}

function Valid-SpreadsheetId([string]$value) {
    return $value -match '^[A-Za-z0-9_-]{20,100}$'
}

$url = "http://127.0.0.1:$port/"
Write-Host ""
Write-Host "Satpraxis TK Scheduler v9 is running locally." -ForegroundColor Green
Write-Host "Open: $url"
Write-Host "Keep this window open. Close it to stop the app." -ForegroundColor Yellow
Write-Host ""
Start-Process $url

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $null
        $reader = $null
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 2048, $true)
            $requestLine = $reader.ReadLine()
            if (-not $requestLine) { continue }
            while (($line = $reader.ReadLine()) -ne $null -and $line -ne "") { }
            $requestParts = $requestLine.Split(' ')
            if ($requestParts.Length -lt 2) {
                Send-Text $stream 400 "Invalid request."
                continue
            }
            if ($requestParts[0] -ne "GET") {
                Send-Text $stream 405 "Only GET is supported."
                continue
            }

            $uri = [System.Uri]::new("http://127.0.0.1" + $requestParts[1])
            $path = $uri.AbsolutePath
            $query = Parse-Query $uri.Query

            if ($path -eq "/" -or $path -eq "/index.html") {
                $file = Join-Path $root "Satpraxis_TK_Scheduler_Test.html"
                Send-Response $stream 200 "text/html; charset=utf-8" ([System.IO.File]::ReadAllBytes($file))
                continue
            }
            if ($path -eq "/api/health") {
                Send-Response $stream 200 "application/json; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes('{"ok":true}'))
                continue
            }
            if ($path -eq "/api/sheets") {
                $spreadsheetId = [string]$query["spreadsheetId"]
                if (-not (Valid-SpreadsheetId $spreadsheetId)) {
                    Send-Text $stream 400 "Invalid spreadsheet id."
                    continue
                }
                try {
                    $remote = "https://docs.google.com/spreadsheets/d/$spreadsheetId/htmlview"
                    $bytes = Download-Google $remote
                    Send-Response $stream 200 "text/html; charset=utf-8" $bytes
                }
                catch {
                    Send-Text $stream 502 ("Google Sheets list request failed: " + $_.Exception.Message)
                }
                continue
            }
            if ($path -eq "/api/sheet") {
                $spreadsheetId = [string]$query["spreadsheetId"]
                $gid = [string]$query["gid"]
                if (-not (Valid-SpreadsheetId $spreadsheetId) -or $gid -notmatch '^\d{1,20}$') {
                    Send-Text $stream 400 "Invalid spreadsheet id or gid."
                    continue
                }
                try {
                    # A one-tab XLSX export drops the red/green fills used by the scheduler.
                    # Download the complete workbook so the browser can select the requested
                    # tab by name while preserving all operational colours.
                    $remote = "https://docs.google.com/spreadsheets/d/$spreadsheetId/export?format=xlsx"
                    $bytes = Download-Google $remote
                    Send-Response $stream 200 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" $bytes
                }
                catch {
                    Send-Text $stream 502 ("Google Sheets export failed: " + $_.Exception.Message)
                }
                continue
            }
            Send-Text $stream 404 "Not found."
        }
        catch {
            try { Send-Text $stream 502 $_.Exception.Message } catch { }
        }
        finally {
            if ($reader) { $reader.Dispose() }
            if ($stream) { $stream.Dispose() }
            $client.Close()
        }
    }
}
finally {
    $listener.Stop()
}
