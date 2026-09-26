# B5: Force UTF-8 console output so accented/non-English paths come back correctly
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

param(
    [string]$FileName = "download",
    [string]$Filter = "All Files (*.*)|*.*"
)

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
