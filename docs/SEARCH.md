# Landing page and search setup

Canonical site: https://koko-invoice.web.app/

The landing page focuses on AI invoice scanning for retail and convenience stores, supplier invoice data extraction, UPC price-book matching, and retail price comparison. These phrases describe shipped workflows; no search-volume or ranking claims are made. It does not claim POS integrations, automatic inventory updates, customer reviews, certifications, or guaranteed savings.

The production build pre-renders the same public React landing page into HTML. Metadata includes a descriptive title, description, canonical URL, social preview and factual Organization/WebSite/SoftwareApplication structured data. There are no fabricated ratings, prices or review counts. robots.txt and sitemap.xml include the public homepage only. The sample demo and calculator run locally and incur no AI requests.

After deployment, verify the site in Google Search Console and submit https://koko-invoice.web.app/sitemap.xml. Inspect the homepage URL to request indexing and review crawl results. Search Console verification needs the site's owner; it has not been performed automatically. Track actual queries, impressions and clicks before expanding keyword coverage. Rankings are not guaranteed.

If the domain changes, update the canonical, Open Graph URL/image, structured-data URLs, robots sitemap reference and sitemap together. Redirect the old public domain if appropriate.

Run `node tests/landing.mjs` with the Vite frontend running on port 5173 (or TEST_URL set) and Chrome installed. This checks simulated scanning, filtering, switching stores, calculator arithmetic, FAQ expansion and mobile overflow. It also refreshes public/social-preview.png, so rebuild afterward.
