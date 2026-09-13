# Third-party notices

Steadbot itself is licensed under Apache-2.0 (see [LICENSE](LICENSE)).

`crew-server/library/` is a curated pool of agent skills copied verbatim from their upstream repositories by
`npm run library:sync`. Each skill directory keeps its upstream `LICENSE` (as `LICENSE.upstream` or the file the
upstream shipped) and a `.source.json` recording the repository, path, commit and license it came from. Nothing in
that directory is our work, and nothing there is relicensed by this repository's LICENSE.

Below is every upstream this repository redistributes, with the license it carries.

| Upstream | License | Skills |
| --- | --- | --- |
| [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) | Apache-2.0 | 77 — `business/brand-review`, `business/campaign-plan`, `business/competitive-brief`, `business/price-check`, `business/quarterly-review`, `design/accessibility-review` … (+71) |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | MIT | 20 — `business/ab-testing`, `business/ad-creative`, `business/ads`, `business/aso`, `business/churn-prevention`, `business/cold-email` … (+14) |
| [anthropics/financial-services](https://github.com/anthropics/financial-services) | Apache-2.0 | 19 — `docs/xlsx-author`, `finance/audit-xls`, `finance/break-trace`, `finance/comps-analysis`, `finance/dcf-model`, `finance/deck-refresh` … (+13) |
| [damionrashford/media-os](https://github.com/damionrashford/media-os) | MIT | 15 — `media/ffmpeg-chromakey`, `media/ffmpeg-cut-concat`, `media/ffmpeg-frames-images`, `media/ffmpeg-speed-time`, `media/ffmpeg-subtitles`, `media/ffmpeg-transcode` … (+9) |
| [RefoundAI/lenny-skills](https://github.com/RefoundAI/lenny-skills) | MIT | 14 — `finance/fundraising`, `people/giving-feedback`, `product/continuous-discovery`, `product/customer-interviews`, `product/defining-icp`, `product/goal-setting-okrs` … (+8) |
| [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | MIT | 10 — `science/citation-management`, `science/experimental-design`, `science/exploratory-data-analysis`, `science/literature-review`, `science/peer-review`, `science/research-grants` … (+4) |
| [AgriciDaniel/claude-seo](https://github.com/AgriciDaniel/claude-seo) | MIT | 8 — `business/seo-audit`, `business/seo-content-brief`, `business/seo-ecommerce`, `business/seo-geo`, `business/seo-local`, `business/seo-page` … (+2) |
| [anthropics/skills](https://github.com/anthropics/skills) | Apache-2.0 | 8 — `business/brand-guidelines`, `design/canvas-design`, `design/theme-factory`, `dev/frontend-design`, `dev/mcp-builder`, `dev/webapp-testing` … (+2) |
| [obra/superpowers](https://github.com/obra/superpowers) | MIT | 8 — `dev/finishing-a-development-branch`, `dev/requesting-code-review`, `dev/systematic-debugging`, `dev/test-driven-development`, `dev/verification-before-completion`, `dev/writing-plans` … (+2) |
| [Mikefluff/skills](https://github.com/Mikefluff/skills) | MIT | 7 — `business/landing-copy`, `design/microcopy`, `dev/release-notes`, `media/subtitle-burner`, `writing/essay-write`, `writing/prose-edit` … (+1) |
| [zh-xx/legal-assistant-skills](https://github.com/zh-xx/legal-assistant-skills) | Apache-2.0 | 6 — `legal/ad-compliance-review`, `legal/contract-gen`, `legal/contract-review-cn`, `legal/food-label-review`, `legal/legal-architecture`, `legal/legal-risk-visualization` |
| [athola/claude-night-market](https://github.com/athola/claude-night-market) | MIT | 5 — `dev/architecture-diagram`, `dev/class-diagram`, `dev/data-flow`, `dev/dependency-graph`, `dev/workflow-diagram` |
| [ahacker-1/cre-agent-skills](https://github.com/ahacker-1/cre-agent-skills) | Apache-2.0 | 4 — `business/cre-development`, `business/cre-due-diligence`, `business/cre-retail`, `finance/cre-lender-credit` |
| [anthropics/k12-teacher-skills](https://github.com/anthropics/k12-teacher-skills) | Apache-2.0 | 4 — `productivity/k12-check-understanding`, `productivity/k12-differentiation`, `productivity/k12-lesson-plan`, `productivity/k12-lesson-prep` |
| [0x0funky/agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge) | MIT | 2 — `design/generate2dmap`, `design/generate2dsprite` |
| [mattpocock/skills](https://github.com/mattpocock/skills) | MIT | 2 — `dev/code-review`, `writing/writing-for-agents` |
| [trailofbits/skills](https://github.com/trailofbits/skills) | see LICENSE | 2 — `dev/differential-review`, `dev/semgrep` |
| [6missedcalls/video-editing-skill](https://github.com/6missedcalls/video-editing-skill) | MIT | 1 — `media/video-editing` |
| [Agents365-ai/drawio-skill](https://github.com/Agents365-ai/drawio-skill) | MIT | 1 — `design/drawio` |
| [Akxan/ppt-agent-skill](https://github.com/Akxan/ppt-agent-skill) | MIT | 1 — `docs/ppt-agent` |
| [Faust-Donf/beamer-academic](https://github.com/Faust-Donf/beamer-academic) | MIT | 1 — `docs/beamer-academic` |
| [Hasasasa/html-to-editable-pptx](https://github.com/Hasasasa/html-to-editable-pptx) | MIT | 1 — `docs/html-to-pptx` |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | MIT | 1 — `dev/code-wiki` |
| [Nutlope/hallmark](https://github.com/Nutlope/hallmark) | MIT | 1 — `design/hallmark` |
| [SlideSpeak/slide-design-skill](https://github.com/SlideSpeak/slide-design-skill) | MIT | 1 — `docs/slide-design` |
| [TianLin0509/img2ppt-lite](https://github.com/TianLin0509/img2ppt-lite) | MIT | 1 — `docs/img2ppt` |
| [alonw0/web-asset-generator](https://github.com/alonw0/web-asset-generator) | MIT | 1 — `design/web-asset-generator` |
| [archlizheng/frontend-slides-editable](https://github.com/archlizheng/frontend-slides-editable) | MIT | 1 — `docs/slides-editable` |
| [deusyu/translate-book](https://github.com/deusyu/translate-book) | MIT | 1 — `writing/translate-book` |
| [myunwang/ppt-report-skills](https://github.com/myunwang/ppt-report-skills) | MIT | 1 — `docs/ppt-report` |
| [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh) | MIT | 1 — `writing/humanizer-zh` |
| [sanjay3290/ai-skills](https://github.com/sanjay3290/ai-skills) | Apache-2.0 | 1 — `research/postgres` |
| [tt-a1i/archify](https://github.com/tt-a1i/archify) | MIT | 1 — `dev/archify` |

Total: 227 skills from 33 repositories.

## Not redistributed here

Four skills in `crew-server/library/manifest.json` — `docs/docx`, `docs/pdf`, `docs/pptx`, `docs/xlsx` — come from
[anthropics/skills](https://github.com/anthropics/skills), whose per-skill `LICENSE.txt` reserves all rights and
forbids reproducing, distributing or retaining copies outside Anthropic's own services. They are listed in the
manifest so `npm run library:sync` can fetch them onto your own machine from the upstream public repository, and
`.gitignore` keeps them out of this repository. If you run that sync, the upstream license governs your copy.

## Runtime dependencies

The npm and PyPI dependencies of `crew-server/` and `bot-crew/` are listed in their `package.json` /
`crew-server/src/engine.json` and are not vendored here; their licenses are their own.
