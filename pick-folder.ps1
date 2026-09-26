param(
    [string]$FileName = "download",
    [string]$Filter = "All Files (*.*)|*.*"
)
# Fix 1: param() must come first. BOM-free UTF-8 so non-English paths round-trip correctly.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.WindowState = 'Minimized'
$form.Show()

$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = "Save Download As"
$dialog.FileName = $FileName
$dialog.Filter = $Filter
$dialog.CheckPathExists = $true
$dialog.OverwritePrompt = $true

if ($dialog.ShowDialog($form) -eq 'OK') {
    Write-Output $dialog.FileName
}

$form.Dispose()
