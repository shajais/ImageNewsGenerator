import urllib.request, ssl, sys

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

urls = [
    ('kalaiyaonline.com', 'https://kalaiyaonline.com/feed/'),
    ('sajhedharipatrika', 'https://sajhedharipatrika.com/feed/'),
    ('baraupdate', 'https://baraupdate.com/feed/'),
    ('birgunj24', 'https://birgunj24.com/feed/'),
    ('prateekdainik', 'https://prateekdainik.com/feed/'),
    ('yatradaily', 'https://yatradaily.com/feed/'),
    ('madheshpost', 'https://madheshpost.com/feed/'),
    ('kalaiyanews', 'https://kalaiyanews.com/feed/'),
    ('sajhedaridainik', 'https://sajhedaridainik.com/feed/'),
    ('birgunjonline', 'https://birgunjonline.com/feed/'),
    ('birgunjkhabar', 'https://birgunjkhabar.com/feed/'),
    ('madheshkhabar', 'https://madheshkhabar.com/feed/'),
    ('onlinekhabar-madhesh', 'https://www.onlinekhabar.com/location/madhesh-pradesh/feed'),
    ('google-kalaiya', 'https://news.google.com/rss/search?q=%E0%A4%95%E0%A4%B2%E0%A5%88%E0%A4%AF%E0%A4%BE+when:2d&hl=ne&gl=NP&ceid=NP:ne'),
]

for name, url in urls:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        r = urllib.request.urlopen(req, context=ctx, timeout=10)
        content = r.read(500).decode('utf-8', errors='replace')
        has_rss = '<rss' in content or '<feed' in content or '<item' in content or '<channel' in content
        print(f"OK  {r.status} {'RSS' if has_rss else 'HTML'} | {name} | {url}")
    except Exception as e:
        print(f"ERR {str(e)[:60]} | {name}")

sys.stdout.flush()
