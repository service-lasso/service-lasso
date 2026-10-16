# Supplementary source witness only. Never execute the supplied source.
using namespace System.Management.Automation.Language
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Require([bool]$condition) { if (-not $condition) { throw [InvalidOperationException]::new('shape_mismatch') } }
function Type-Is($node, [string]$name) { return $null -ne $node -and $node.GetType().Name -ceq $name }
function Statements($block, $expected) {
    Require ($null -ne $block -and @($block.Traps).Count -eq 0)
    $actual = @($block.Statements)
    Require ($actual.Count -eq @($expected).Count)
    for ($i = 0; $i -lt $actual.Count; $i++) { Match $actual[$i] $expected[$i] }
}
function Parameters($actual, $expected) {
    Require (@($actual).Count -eq @($expected).Count)
    for ($i = 0; $i -lt @($actual).Count; $i++) {
        $a = $actual[$i]; $e = $expected[$i]
        Require (Type-Is $a 'ParameterAst')
        Match $a.Name @{kind='var'; name=$e.name}
        $attrs = @($a.Attributes)
        if ($null -eq $e.typeName) { Require ($attrs.Count -eq 0) }
        else { Require ($attrs.Count -eq 1); Require (Type-Is $attrs[0] 'TypeConstraintAst'); Require ($attrs[0].TypeName.FullName -ceq $e.typeName) }
        if ($null -eq $e.defaultValue) { Require ($null -eq $a.DefaultValue) } else { Match $a.DefaultValue $e.defaultValue }
    }
}
function Body($node, $expected, $parameters, $attributes) {
    Require (Type-Is $node 'ScriptBlockAst')
    Require ($null -eq $node.DynamicParamBlock -and $null -eq $node.BeginBlock -and $null -eq $node.ProcessBlock -and $null -eq $node.CleanBlock)
    Require ($null -ne $node.EndBlock -and $node.EndBlock.Unnamed)
    Require (@($node.Attributes).Count -eq 0 -and @($node.UsingStatements).Count -eq 0)
    if ($null -eq $parameters) { Require ($null -eq $node.ParamBlock) }
    else {
        Require ($null -ne $node.ParamBlock)
        Parameters $node.ParamBlock.Parameters $parameters
        $attrs = @($node.ParamBlock.Attributes)
        Require ($attrs.Count -eq @($attributes).Count)
        for ($i=0; $i -lt $attrs.Count; $i++) { Require (Type-Is $attrs[$i] 'AttributeAst'); Require ($attrs[$i].TypeName.FullName -ceq $attributes[$i]); Require (@($attrs[$i].PositionalArguments).Count -eq 0 -and @($attrs[$i].NamedArguments).Count -eq 0) }
    }
    Statements $node.EndBlock $expected
}
function Match($a, $e) {
    Require ($null -ne $a -and $null -ne $e)
    # PowerShell inserts statement/pipeline expression wrappers. Consume only
    # these closed, side-effect-free wrappers, never arbitrary descendant search.
    if ($e.kind -ne 'pipeline' -and (Type-Is $a 'PipelineAst')) {
        Require (-not $a.Background -and $a.PipelineElements.Count -eq 1)
        Match $a.PipelineElements[0] $e; return
    }
    if (Type-Is $a 'CommandExpressionAst') { Require (@($a.Redirections).Count -eq 0); Match $a.Expression $e; return }
    switch -CaseSensitive ($e.kind) {
        'var' { Require (Type-Is $a 'VariableExpressionAst'); Require (-not $a.Splatted -and $a.VariablePath.UserPath -ceq $e.name) }
        'literal' { Require (Type-Is $a 'StringConstantExpressionAst'); Require ($a.Value -ceq $e.value -and $a.StringConstantType.ToString() -ceq $e.form) }
        'number' { Require (Type-Is $a 'ConstantExpressionAst'); Require ($a.Value -eq $e.value) }
        'type' { Require (Type-Is $a 'TypeExpressionAst'); Require ($a.TypeName.FullName -ceq $e.name) }
        'member' { Require (Type-Is $a 'MemberExpressionAst'); Require ($a.Static -eq $e.static -and -not $a.NullConditional); Match $a.Expression $e.target; Match $a.Member $e.member }
        'invokeMember' { Require (Type-Is $a 'InvokeMemberExpressionAst'); Require ($a.Static -eq $e.static -and -not $a.NullConditional); Match $a.Expression $e.target; Match $a.Member $e.member; Sequence $a.Arguments $e.args }
        'command' { Require (Type-Is $a 'CommandAst'); Require ($a.InvocationOperator.ToString() -ceq 'Unknown' -and @($a.Redirections).Count -eq 0 -and $null -eq $a.DefiningKeyword); Require ($a.CommandElements.Count -eq @($e.args).Count + 1); Match $a.CommandElements[0] @{kind='literal';value=$e.name;form='BareWord'}; for($i=0;$i -lt @($e.args).Count;$i++){ Match $a.CommandElements[$i+1] $e.args[$i] } }
        'parameter' { Require (Type-Is $a 'CommandParameterAst'); Require ($a.ParameterName -ceq $e.name -and $null -eq $a.Argument) }
        'binary' { Require (Type-Is $a 'BinaryExpressionAst'); Require ($a.Operator.ToString() -ceq $e.op); Match $a.Left $e.left; Match $a.Right $e.right }
        'unary' { Require (Type-Is $a 'UnaryExpressionAst'); Require ($a.TokenKind.ToString() -ceq $e.op); Match $a.Child $e.child }
        'convert' { Require (Type-Is $a 'ConvertExpressionAst'); Require ($a.Type.TypeName.FullName -ceq $e.name); Match $a.Child $e.child }
        'index' { Require (Type-Is $a 'IndexExpressionAst'); Require (-not $a.NullConditional); Match $a.Target $e.target; Match $a.Index $e.index }
        'paren' { Require (Type-Is $a 'ParenExpressionAst'); Match $a.Pipeline $e.expression }
        'expandable' { Require (Type-Is $a 'ExpandableStringExpressionAst'); Require ($a.Value -ceq $e.value); Sequence $a.NestedExpressions $e.nested }
        'assign' { Require (Type-Is $a 'AssignmentStatementAst'); Require ($a.Operator.ToString() -ceq $e.op); Match $a.Left $e.left; Match $a.Right $e.right }
        'if' { Require (Type-Is $a 'IfStatementAst'); Require ($a.Clauses.Count -eq @($e.clauses).Count); for($i=0;$i -lt $a.Clauses.Count;$i++){ Match $a.Clauses[$i].Item1 $e.clauses[$i].condition; Statements $a.Clauses[$i].Item2 $e.clauses[$i].body }; if($null -eq $e.otherwise){ Require ($null -eq $a.ElseClause) }else{ Statements $a.ElseClause $e.otherwise } }
        'return' { Require (Type-Is $a 'ReturnStatementAst'); Optional $a.Pipeline $e.expression }
        'throw' { Require (Type-Is $a 'ThrowStatementAst'); Optional $a.Pipeline $e.expression }
        'foreach' { Require (Type-Is $a 'ForEachStatementAst'); Require ($a.Flags.ToString() -ceq 'None' -and $null -eq $a.Label -and $null -eq $a.ThrottleLimit); Match $a.Variable @{kind='var';name=$e.name}; Match $a.Condition $e.source; Statements $a.Body $e.body }
        'try' { Require (Type-Is $a 'TryStatementAst'); Statements $a.Body $e.body; Require ($a.CatchClauses.Count -eq @($e.catches).Count); for($i=0;$i -lt $a.CatchClauses.Count;$i++){ Require ($a.CatchClauses[$i].IsCatchAll -and $a.CatchClauses[$i].CatchTypes.Count -eq 0); Statements $a.CatchClauses[$i].Body $e.catches[$i] }; if($null -eq $e.finallyBody){ Require ($null -eq $a.Finally) }else{ Statements $a.Finally $e.finallyBody } }
        'hashtable' { Require (Type-Is $a 'HashtableAst'); Require ($a.KeyValuePairs.Count -eq @($e.fields).Count); for($i=0;$i -lt $a.KeyValuePairs.Count;$i++){ Match $a.KeyValuePairs[$i].Item1 $e.fields[$i].key; Match $a.KeyValuePairs[$i].Item2 $e.fields[$i].value } }
        'pipeline' { Require (Type-Is $a 'PipelineAst'); Require (-not $a.Background); Sequence $a.PipelineElements $e.items }
        'scriptBlockExpression' { Require (Type-Is $a 'ScriptBlockExpressionAst'); Body $a.ScriptBlock $e.body $null @() }
        'subExpression' { Require (Type-Is $a 'SubExpressionAst'); Statements $a.SubExpression $e.body }
        'function' { Require (Type-Is $a 'FunctionDefinitionAst'); Require ($a.Name -ceq $e.name -and -not $a.IsFilter -and -not $a.IsWorkflow); Parameters $a.Parameters $e.parameters; Body $a.Body $e.body $null @() }
        'for' { Require (Type-Is $a 'ForStatementAst'); Require ($null -eq $a.Label); Match $a.Initializer $e.initializer; Match $a.Condition $e.condition; Match $a.Iterator $e.iterator; Statements $a.Body $e.body }
        'while' { Require (Type-Is $a 'WhileStatementAst'); Require ($null -eq $a.Label); Match $a.Condition $e.condition; Statements $a.Body $e.body }
        'arrayExpr' { Require (Type-Is $a 'ArrayExpressionAst'); $items=@($e.items); if($items.Count -eq 0){ Statements $a.SubExpression @() }elseif($items.Count -eq 1){ Statements $a.SubExpression @($items[0]) }else{ Statements $a.SubExpression @(@{kind='arrayLiteral';items=$items}) } }
        'arrayLiteral' { Require (Type-Is $a 'ArrayLiteralAst'); Sequence $a.Elements $e.items }
        'continue' { Require (Type-Is $a 'ContinueStatementAst'); Require ($null -eq $a.Label) }
        default { throw [InvalidOperationException]::new('unknown_catalogue_kind') }
    }
}
function Sequence($actual,$expected){ Require (@($actual).Count -eq @($expected).Count); for($i=0;$i -lt @($actual).Count;$i++){ Match $actual[$i] $expected[$i] } }
function Optional($actual,$expected){ if($null -eq $expected){ Require ($null -eq $actual) }else{ Match $actual $expected } }

# Input framing errors are infrastructure failures, never source rejections.
try {
    $utf8=[Text.UTF8Encoding]::new($false,$true)
    $raw=[IO.MemoryStream]::new(); [Console]::OpenStandardInput().CopyTo($raw)
    $text=$utf8.GetString($raw.ToArray())
    $inputDoc=[Text.Json.JsonDocument]::Parse($text)
    $root=$inputDoc.RootElement
    Require ($root.ValueKind -eq [Text.Json.JsonValueKind]::Object)
    $names=@($root.EnumerateObject() | ForEach-Object Name)
    Require (($names -join '|') -ceq 'schema|sourceFile|sourceByteLength|sourceSha256|sourceBase64')
    $schema=$root.GetProperty('schema').GetString(); $file=$root.GetProperty('sourceFile').GetString()
    $length=$root.GetProperty('sourceByteLength').GetInt32(); $digest=$root.GetProperty('sourceSha256').GetString(); $base64=$root.GetProperty('sourceBase64').GetString()
    Require ($schema -ceq 'core1562.f25.ast-input.v1' -and $file -ceq 'scripts/verify-windows-managed-launcher-bootstrap.ps1' -and $digest -cmatch '^[0-9a-f]{64}$')
    $canonical='{"schema":"core1562.f25.ast-input.v1","sourceFile":"scripts/verify-windows-managed-launcher-bootstrap.ps1","sourceByteLength":'+$length+',"sourceSha256":"'+$digest+'","sourceBase64":"'+$base64+'"}'+"`n"
    Require ($text -ceq $canonical)
    $bytes=[Convert]::FromBase64String($base64)
    Require ([Convert]::ToBase64String($bytes) -ceq $base64 -and $bytes.Length -eq $length)
    Require ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() -ceq $digest)
    $source=$utf8.GetString($bytes)
    $catalogue=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'core1562-f25-semantic-roles.json') -Raw | ConvertFrom-Json -AsHashtable
    Require ($catalogue.schema -ceq 'core1562.f25.semantic-roles.v1')
} catch { exit 3 }
$tokens=$null; $errors=$null
$ast=[Parser]::ParseInput($source,$file,[ref]$tokens,[ref]$errors)
$status='conformant'; $reason='none'; $code=0
if(@($errors).Count -ne 0){ $status='rejected';$reason='parse_error';$code=2 }
else { try { Body $ast $catalogue.body $catalogue.parameters $catalogue.attributes } catch { if($_.Exception.Message -cne 'shape_mismatch'){ exit 3 }; $status='rejected';$reason='shape_mismatch';$code=2 } }
$response='{"schema":"core1562.f25.ast-result.v1","status":"'+$status+'","sourceSha256":"'+$digest+'","reason":"'+$reason+'"}'+"`n"
$output=$utf8.GetBytes($response); $stream=[Console]::OpenStandardOutput(); $stream.Write($output,0,$output.Length); $stream.Flush()
exit $code
