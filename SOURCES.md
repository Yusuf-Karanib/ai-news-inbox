# Included feeds

The original 25 feeds were checked from the Supabase-compatible Deno runtime on
8 September 2026. Four additional feeds were checked again on 13 September 2026. All
29 returned usable content. They are fixed in both the database
migrations and the code allowlist.

| Source | What it covers | Important limit |
|---|---|---|
| [OpenAI News](https://openai.com/news/rss.xml) | OpenAI models, products, research, and safety | Large feed; company claims are still company claims |
| [OpenAI Codex Releases](https://github.com/openai/codex/releases.atom) | Codex open-source releases | Many small or preview releases are filtered |
| [OpenAI Status](https://status.openai.com/history.atom) | OpenAI and occasional Codex incidents | Resolved and routine incidents are filtered |
| [Anthropic Platform Release Notes](https://platform.claude.com/docs/en/release-notes/feed.xml) | Claude API, SDK, and platform changes | Does not cover every Claude app announcement |
| [Claude Status](https://status.claude.com/history.atom) | Claude service incidents | Resolved and routine incidents are filtered |
| [xAI Release Notes](https://docs.x.ai/developers/release-notes.md) | Grok models, APIs, Grok Bot, pricing, and retirements | Month-level dates only; first read creates a silent baseline |
| [xAI Status](https://status.x.ai/feed.xml) | Grok service incidents | Resolved and routine incidents are filtered |
| [NVIDIA Generative AI News](https://nvidianews.nvidia.com/cats/generative_al.xml) | NVIDIA generative-AI announcements | Low volume; vendor claims are not independent proof |
| [NVIDIA Technical Blog](https://developer.nvidia.com/blog/feed/) | CUDA, AI, inference, robotics, and hardware development | Generic how-to guides are filtered from news |
| [AMD Newsroom](https://newsroom.amd.com/rss.xml?content-type=news) | Chips, accelerators, and company announcements | Only AI-relevant hardware is kept |
| [Google DeepMind](https://deepmind.google/blog/rss.xml) | AI research, models, and products | Research and company claims still need context |
| [Hugging Face Blog](https://huggingface.co/blog/feed.xml) | Open models, tools, and research | Includes community material and is heavily filtered |
| [Microsoft AI News](https://news.microsoft.com/source/topics/ai/feed/) | Microsoft AI products and use cases | Marketing case studies are normally filtered |
| [TechCrunch AI](https://techcrunch.com/category/artificial-intelligence/feed/) | High-level AI companies, products, funding, and policy | Publisher reports can contain rumors or event promotion |
| [The Verge AI](https://www.theverge.com/rss/ai-artificial-intelligence/index.xml) | Readable AI product, company, and policy news | Publisher analysis is not an official company statement |
| [42 Abu Dhabi](https://42abudhabi.ae/feed/) | Public 42 Abu Dhabi news and events | Does not reveal private admission or Bocal information |
| [BBC World](https://feeds.bbci.co.uk/news/world/rss.xml) | World-news fallback | Only clearly major stories can pass; never fills an AI slot by force |
| [Al Jazeera News](https://www.aljazeera.com/xml/rss/all.xml) | World politics and major global events | Sport, minor stories, and opinion pages are filtered |
| [Jobicy UAE Internships](https://jobicy.com/jobs/feed?type=internship&geo=united-arab-emirates) | Current UAE and remote internship listings | Jobicy is an aggregator; verify employer, eligibility, pay, location, and deadline |
| [AWS What's New](https://aws.amazon.com/about-aws/whats-new/recent/feed/) | AWS launches, regions, pricing, and changes | Very high volume |
| [AWS Security Bulletins](https://aws.amazon.com/security/security-bulletins/rss/feed/) | Official AWS security notices | Only AWS-related issues |
| [Supabase Changelog](https://supabase.com/changelog-rss.xml) | Supabase changes and breaking notices | Not every long blog post |
| [n8n Blog](https://blog.n8n.io/rss/) | Automation, agents, security, and guides | Generic tutorials and marketing posts are filtered |
| [Docker Blog](https://www.docker.com/blog/feed/) | Docker, containers, security, and AI development | Only a small recent window |
| [Docker Security Announcements](https://docs.docker.com/security/security-announcements/index.xml) | Official Docker security fixes and CVEs | Items have no dates, so the first read becomes a silent baseline |
| [GitHub Changelog](https://github.blog/changelog/feed/) | GitHub releases, retirements, Actions, and Copilot | High volume; small recent window |
| [Python Insider](https://blog.python.org/rss.xml) | CPython releases and core development | Does not cover all Python packages |
| [ROS Announcements](https://discourse.openrobotics.org/c/ros/ros-announcements-news/112.rss) | ROS releases and official community notices | Some authors are community maintainers |
| [Dubai Future Foundation](https://www.dubaifuture.ae/feed/) | UAE innovation, programmes, and occasional applications | Not a complete UAE opportunities list |

There is no invented UAE opportunity feed in this package. Useful pages from
TII, Hub71, UAE Space Agency, MBZUAI, Khalifa University, NYU Abu Dhabi, and
government job portals do not provide dependable feeds, so this free version
does not pretend to monitor them completely. Opportunities still require a
manual official-page eligibility check.

The daily selector reserves one place for an opportunity. If these dependable
feeds do not contain a current opportunity that passes the filters, it leaves
that place empty and sends no more than nine other stories.

There is also no dependable free feed for every X post. The official X API is
paid and unofficial mirrors are fragile. Posts can be pasted into Telegram with
a short topic description.
