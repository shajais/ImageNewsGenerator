import urllib.request, ssl, sys

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# Test different feed paths for kalaiyaonline and other sites
urls = [
    ('kalaiyaonline-feed', 'https://kalaiyaonline.com/feed'),
    ('kalaiyaonline-rss', 'https://kalaiyaonline.com/rss'),
    ('kalaiyaonline-rss2', 'https://kalaiyaonline.com/rss.xml'),
    ('kalaiyaonline-home', 'https://kalaiyaonline.com/'),
    ('prateek-home', 'https://prateekdainik.com/'),
    ('yatra-home', 'https://yatradaily.com/'),
    ('birgunj24-home', 'https://birgunj24.com/'),
    ('baraupdate-home', 'https://baraupdate.com/'),
    # Google with 2d filter - various queries
    ('google-kalaiya-ne-2d', 'https://news.google.com/rss/search?q=%E0%A4%95%E0%A4%B2%E0%A5%88%E0%A4%AF%E0%A4%BE+when:2d&hl=ne&gl=NP&ceid=NP:ne'),
    ('google-bara-ne-2d', 'https://news.google.com/rss/search?q=%E0%A4%AC%E0%A4%BE%E0%A4%B0%E0%A4%BE+when:2d&hl=ne&gl=NP&ceid=NP:ne'),
    ('google-kalaiya-en-2d', 'https://news.google.com/rss/search?q=Kalaiya+Bara+Nepal+when:2d&hl=en&gl=NP&ceid=NP:en'),
    ('google-madhesh-2d', 'https://news.google.com/rss/search?q=%E0%A4%AE%E0%A4%A7%E0%A5%87%E0%A4%B6+%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%A6%E0%A5%87%E0%A4%B6+when:2d&hl=ne&gl=NP&ceid=NP:ne'),
    # ekantipur madhesh
    ('ekantipur-madhesh', 'https://ekantipur.com/rss/madhesh'),
    # ratopati madhesh
    ('ratopati-madhesh', 'https://ratopati.com/category/madhesh/feed'),
    # setopati madhesh
    ('setopati-madhesh', 'https://setopati.com/category/madhesh/feed'),
    # nagariknews madhesh
    ('nagarik-madhesh', 'https://nagariknews.nagariknetwork.com/category/madhesh/feed'),
    # madheshpost all
    ('madheshpost-all', 'https://madheshpost.com/feed/'),
    # onlinekhabar madhesh
    ('onlinekhabar-madhesh', 'https://www.onlinekhabar.com/location/madhesh-pradesh/feed'),
    # onlinekhabar bara
    ('onlinekhabar-bara', 'https://www.onlinekhabar.com/location/bara/feed'),
]

for name, url in urls:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        r = urllib.request.urlopen(req, context=ctx, timeout=12)
        content = r.read(800).decode('utf-8', errors='replace')
        has_rss = '<rss' in content or '<feed' in content or '<item' in content or '<channel' in content
        item_count = content.count('<item')
        print(f"OK  {r.status} {'RSS' if has_rss else 'HTML'} items~{item_count} | {name}")
    except Exception as e:
        print(f"ERR {str(e)[:60]} | {name}")

sys.stdout.flush()
