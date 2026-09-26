# Fix 1: BOM-free UTF-8 (no param block needed here, so encoding goes at top)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

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
