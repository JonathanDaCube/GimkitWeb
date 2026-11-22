$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icon = New-Object System.Windows.Forms.NotifyIcon
try {
    $icon.Icon = [System.Drawing.SystemIcons]::Information
    $icon.Visible = $true
    $icon.ShowBalloonTip(10000, 'GimkitWeb meeting started', $env:GIMKIT_MEETING_TITLE, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Seconds 10
} finally {
    $icon.Dispose()
}
