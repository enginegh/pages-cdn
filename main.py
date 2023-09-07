import requests

r = requests.get('https://19135ff5.cdn-cef.pages.dev/manifest.json').json()

for item in r:
    print(item['path'])
    print(requests.head("https://19135ff5.cdn-cef.pages.dev"+item['path']).status_code)