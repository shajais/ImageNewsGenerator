import urllib.request, re, sys

# Fetch the actual served app.js
res = urllib.request.urlopen('http://localhost:3000/app.js?v=20260328d')
js = res.read().decode('utf-8')
lines = js.split('\n')
print(f'Total lines: {len(lines)}, Total bytes: {len(js)}')

# Check for unclosed template literals (backtick strings)
bt_count = js.count('`')
status = 'EVEN - OK' if bt_count % 2 == 0 else 'ODD - UNCLOSED TEMPLATE LITERAL!'
print(f'Backtick count: {bt_count} ({status})')

# Check brace balance line by line
depth = 0
for i, line in enumerate(lines, 1):
    for ch in line:
        if ch == '{': depth += 1
        elif ch == '}': depth -= 1
    if depth < 0:
        print(f'Line {i}: BRACE DEPTH WENT NEGATIVE ({depth}): {line[:80]}')
        break
print(f'Final brace depth: {depth} ({"OK" if depth == 0 else "UNBALANCED!"})')

# Find ALL function declarations and check they have a body
print('\n--- Checking for suspicious empty/truncated functions ---')
for i, line in enumerate(lines, 1):
    stripped = line.strip()
    # Functions that end with just { and the next line is }
    if i < len(lines):
        next_stripped = lines[i].strip()
        if stripped.endswith('{') and next_stripped == '}':
            print(f'Lines {i}-{i+1}: EMPTY FUNCTION: {stripped}')

# Check for lines that look like truncated code
print('\n--- Checking for lines ending mid-expression ---')
suspicious = []
for i, line in enumerate(lines, 1):
    s = line.rstrip()
    stripped = s.strip()
    # Lines that end with ( or , that are not in comments/strings
    if stripped and not stripped.startswith('//') and not stripped.startswith('*'):
        if stripped.endswith(('(', ',')) and not stripped.endswith('*/'):
            suspicious.append((i, stripped[:100]))

for i, s in suspicious[:20]:
    print(f'  Line {i}: {s}')

# Look for loadKeyStatus function specifically - it had truncation issues
print('\n--- loadKeyStatus function ---')
idx = js.find('async function loadKeyStatus')
if idx >= 0:
    chunk = js[idx:idx+400]
    print(chunk)
else:
    print('NOT FOUND!')

# Look for callGemini
print('\n--- callGemini function ---')
idx2 = js.find('async function callGemini')
if idx2 >= 0:
    chunk2 = js[idx2:idx2+300]
    print(chunk2)
else:
    print('NOT FOUND!')

# Check fetchRawHtml
print('\n--- fetchRawHtml ---')
idx3 = js.find('async function fetchRawHtml')
if idx3 >= 0:
    chunk3 = js[idx3:idx3+400]
    print(chunk3)
else:
    print('NOT FOUND!')
