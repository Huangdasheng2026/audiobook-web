$port = 8080
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
# 解决中文乱码：把控制台输出编码改为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
Write-Host "服务器已启动: http://localhost:$port" -ForegroundColor Green
Write-Host "按 Ctrl+C 停止" -ForegroundColor Gray

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $path = $req.Url.LocalPath.TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = Join-Path $root $path

    if (Test-Path $file -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ext = [System.IO.Path]::GetExtension($file)
        $mime = @{
            '.html' = 'text/html; charset=utf-8'
            '.css' = 'text/css; charset=utf-8'
            '.js' = 'application/javascript; charset=utf-8'
            '.json' = 'application/json'
            '.svg' = 'image/svg+xml'
        }
        $res.ContentType = $mime[$ext]
        if (-not $res.ContentType) { $res.ContentType = 'application/octet-stream' }
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $res.StatusCode = 404
        $data = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $res.OutputStream.Write($data, 0, $data.Length)
    }
    $res.Close()
}

$listener.Stop()
