import urllib.request
import urllib.error
import json

KEY = 'AIzaSyBMlZF4c9m1hJxZMjQp66KTbtERN8rQJYM'
URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + KEY

body = json.dumps({
    'contents': [{'parts': [{'text': 'Say hello'}]}],
    'generationConfig': {'maxOutputTokens': 30}
}).encode('utf-8')

print('=== Direct Gemini API Test ===')
print(f'Key prefix: {KEY[:12]}...')
try:
    req = urllib.request.Request(
        URL,
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        print(f'HTTP: {resp.status}')
        data = json.loads(raw)
        text = data['candidates'][0]['content']['parts'][0]['text']
        print(f'Gemini replied: {text}')
        print('SUCCESS: API key is valid!')
except urllib.error.HTTPError as e:
    body_err = e.read().decode('utf-8', errors='replace')
    print(f'HTTP Error {e.code}: {body_err[:400]}')
except Exception as ex:
    print(f'Exception: {type(ex).__name__}: {ex}')

print()
print('=== Local Proxy Test (/proxy/gemini-withkey) ===')
try:
    req2 = urllib.request.Request(
        'http://localhost:3000/proxy/gemini-withkey',
        data=body,
        headers={'Content-Type': 'application/json', 'x-gemini-key': KEY},
        method='POST'
    )
    with urllib.request.urlopen(req2, timeout=30) as resp2:
        raw2 = resp2.read()
        print(f'HTTP: {resp2.status}')
        data2 = json.loads(raw2)
        text2 = data2['candidates'][0]['content']['parts'][0]['text']
        print(f'Proxy replied: {text2}')
        print('SUCCESS: Proxy is working!')
except urllib.error.HTTPError as e2:
    body_err2 = e2.read().decode('utf-8', errors='replace')
    print(f'HTTP Error {e2.code}: {body_err2[:400]}')
except Exception as ex2:
    print(f'Exception: {type(ex2).__name__}: {ex2}')
    print('(Make sure python server.py is running on port 3000)')
