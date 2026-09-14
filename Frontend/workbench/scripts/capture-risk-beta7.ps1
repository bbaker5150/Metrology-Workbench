param([Parameter(Mandatory=$true)][string]$WorkbookPath,
      [Parameter(Mandatory=$true)][string]$CasesPath,
      [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
# A separate Excel instance opens the supplied workbook read-only. Events are
# disabled so no workbook-open or sheet-change handlers run. Only the reviewed
# mathematical row procedure is invoked; the source is closed without saving.
$inputColumns = @{ nominal=6; lowerLimit=7; upperLimit=8; initialGB=9; uCal=10; mu=11; xcal=12;
  tur=19; reop=20; turNeeded=21; originalInterval=26; pfaTarget=27; reopTarget=28; decayModel=29; weibullBeta=30; resolution=31 }
$outputColumns = @{ asymmetry=13; tolType=14; obs=33; pfa=34; pfr=35; maxReop=36; trueReop=37; gbMult=38;
  physGbLower=39; physGbUpper=40; mitPfa=41; mitPfr=42; gbInterval=43; mitReop=44;
  intPfa=45; intPfr=46; intInterval=47; intReop=48; statusCore=50; statusMit=51; statusInt=52; mitObs=53; intObs=54 }
$cases = Get-Content -LiteralPath $CasesPath -Raw | ConvertFrom-Json
$captures = [Collections.Generic.List[object]]::new()
$excel = $null; $book = $null; $sheet = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.EnableEvents = $false
  $book = $excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path, 0, $true)
  $sheet = $book.Worksheets.Item('RISK_CALC_SCRATCH')
  foreach ($case in $cases) {
    $inputCells = [object[,]]::new(1, 54)
    foreach ($property in $case.input.PSObject.Properties) {
      # Compare as text: PowerShell's numeric 0 -ne '' coerces '' to zero and
      # silently drops boundary inputs. Zero is a real input, never an empty cell.
      if ($inputColumns.ContainsKey($property.Name) -and $null -ne $property.Value -and [string]$property.Value -ne '') {
        $value = $property.Value
        if ($value -is [ValueType]) { $value = [double]$value }
        $inputCells[0, ($inputColumns[$property.Name] - 1)] = $value
      }
    }
    $sheet.Range('A7:BB7').Value2 = $inputCells
    $written = $sheet.Range('A7:BB7').Value2
    foreach ($property in $case.input.PSObject.Properties) {
      if ($inputColumns.ContainsKey($property.Name)) {
        $actualInput = $written[1, $inputColumns[$property.Name]]
        if ([string]$actualInput -ne [string]$property.Value) {
          throw "Input capture mismatch: $($case.id) / $($property.Name)"
        }
      }
    }
    [void]$excel.Run("'" + $book.Name + "'!modRiskBackend.ComputeOneRow", $sheet, 7)
    $values = $sheet.Range('A7:BB7').Value2
    $expected = [ordered]@{}
    foreach ($key in ($outputColumns.Keys | Sort-Object)) {
      $value = $values[1, $outputColumns[$key]]
      $expected[$key] = if ($null -eq $value) { '' } else { $value }
    }
    $captures.Add([ordered]@{ id=$case.id; input=$case.input; expected=$expected })
    if ($captures.Count % 50 -eq 0) { Write-Output "Captured $($captures.Count)/$($cases.Count) cases" }
  }
  $result = [ordered]@{ source='Unc Tool v8.00-Beta.7.xlsm'; sha256=(Get-FileHash -LiteralPath $WorkbookPath).Hash;
    procedure='modRiskBackend.ComputeOneRow on RISK_CALC_SCRATCH row 7'; capturedAt=[DateTime]::UtcNow.ToString('o'); cases=$captures }
  $result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding utf8
  Write-Output "Captured $($captures.Count) cases to $OutputPath"
} finally {
  if ($book) { $book.Close($false) }
  if ($excel) { $excel.Quit() }
  foreach ($object in @($sheet, $book, $excel)) { if ($object) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object) } }
}
