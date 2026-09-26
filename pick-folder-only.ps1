# B5: Force UTF-8 console output so accented/non-English paths come back correctly
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.WindowState = 'Minimized'
$form.Show()

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select folder to save playlist files"
$dialog.ShowNewFolderButton = $true
$dialog.RootFolder = [System.Environment+SpecialFolder]::MyComputer

if ($dialog.ShowDialog($form) -eq 'OK') {
    Write-Output $dialog.SelectedPath
}

$form.Dispose()
