content = open('index.html', 'r', encoding='utf-8').read()

start_marker = '      <!-- LEFT COLUMN: Controls -->'
end_marker = '      </div><!-- end meme-left-col -->'

start = content.index(start_marker)
end = content.index(end_marker) + len(end_marker)

left_col = content[start:end]

a_start = left_col.index('        <!-- \u2500\u2500 From News Article \u2500\u2500 -->')
a_end   = left_col.index('        <!-- \u2500\u2500 Step 1: Topic / Prompt \u2500\u2500 -->')
block_news = left_col[a_start:a_end]

b_start = a_end
b_end   = left_col.index('        <!-- \u2500\u2500 Step 2: Image Source')
block_topic = left_col[b_start:b_end]

c_start = b_end
c_end   = left_col.index('        <!-- \u2500\u2500 Step 3: Circle Overlays')
block_bg = left_col[c_start:c_end]

d_start = c_end
d_end   = left_col.index('        <!-- \u2500\u2500 Step 4: Text Editing')
block_circles = left_col[d_start:d_end]

e_start = d_end
e_end   = left_col.index('        <!-- \u2500\u2500 Step 5: Caption')
block_text = left_col[e_start:e_end]

f_start = e_end
f_end   = left_col.index('        <!-- \u2500\u2500 Trending Topics')
block_caption = left_col[f_start:f_end]

g_start = f_end
g_end   = left_col.index('      </div><!-- end meme-left-col -->')
block_trending = left_col[g_start:g_end]

# Renumber step labels
block_bg       = block_bg.replace('Step 2: Image Source \u2014 collapsible', 'Step 1: Background Panels \u2014 collapsible')
block_circles  = block_circles.replace('Step 3: Circle Overlays \u2014 collapsible', 'Step 2: Circle Overlays \u2014 collapsible')
block_text     = block_text.replace('Step 4: Text Editing', 'Step 3: Text Editing')
block_caption  = block_caption.replace('Step 5: Caption', 'Step 4: Caption')
block_trending = block_trending.replace('\u2500\u2500 Trending Topics', '\u2500\u2500 Step 5: Trending Topics')
block_topic    = block_topic.replace('Step 1: Topic / Prompt', 'Step 6: Topic / Prompt')

header = '      <!-- LEFT COLUMN: Controls -->\n      <div class="meme-left-col">\n\n'
footer = '      </div><!-- end meme-left-col -->'

new_left = header + block_bg + block_circles + block_text + block_caption + block_trending + block_topic + block_news + footer

new_content = content[:start] + new_left + content[end:]
open('index.html', 'w', encoding='utf-8').write(new_content)
print('Done - sections reordered successfully')
