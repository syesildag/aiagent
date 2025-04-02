import { PlaywrightCrawler } from 'crawlee';

// Create an instance of the PlaywrightCrawler class - a crawler
// that automatically loads the URLs in headless Chrome / Playwright.
const crawler = new PlaywrightCrawler({

   preNavigationHooks: [
      async ({ request, page, log }) => {
         log.info(`Navigating to ${request.url}...`);
         // Here you can add any pre-navigation logic, such as setting cookies or modifying headers.
         // For example:
         // await page.setCookie({ name: 'myCookie', value: 'cookieValue' });
         page.context().addCookies([
            {
               name: 'JSESSIONID',
               value: 'DED838CD1FBC6E443D516ACA3A6B25E7',
               url: request.url,
            },
         ]);
      }
   ],

   launchContext: {
      // Here you can set options that are passed to the playwright .launch() function.
      launchOptions: {
         headless: true,
      },
   },

   // Stop crawling after several pages
   maxRequestsPerCrawl: 10,

   // This function will be called for each URL to crawl.
   // Here you can write the Playwright scripts you are familiar with,
   // with the exception that browsers and pages are automatically managed by Crawlee.
   // The function accepts a single parameter, which is an object with a lot of properties,
   // the most important being:
   // - request: an instance of the Request class with information such as URL and HTTP method
   // - page: Playwright's Page object (see https://playwright.dev/docs/api/class-page)
   async requestHandler({ pushData, request, page, enqueueLinks, log }) {
      log.info(`Processing ${request.url}...`);

      // A function to be evaluated by Playwright within the browser context.
      const data = await page.$$eval('div.body-post', $posts => {
         const scrapedData: { title: string, content: string, tags: string, date: string, href: string }[] = [];

         // We're getting the title, rank and URL of each post on Hacker News.
         $posts.forEach($post => {
            scrapedData.push({
               title: ($post.querySelector('h2.home-title') as HTMLElement)?.innerText || '',
               content: ($post.querySelector('div.home-desc') as HTMLElement)?.innerText || '',
               tags: ($post.querySelector('.h-tags') as HTMLElement)?.innerText || '',
               date: ($post.querySelector('.h-datetime') as HTMLElement)?.childNodes[1].textContent || '',
               href: ($post.querySelector('a.story-link') as HTMLAnchorElement)?.href || '',
            });
         });

         return scrapedData;
      });

      // Store the results to the default dataset.
      await pushData(data);

      if(data.length > 0) {
         const minDate = new Date(Math.min(...data.map(item => new Date(item.date)) as any));
         let lastWeek = new Date();
         lastWeek.setDate(lastWeek.getDate() - 7);
         if (minDate > lastWeek) {
            // Find a link to the next page and enqueue it if it exists.
            const infos = await enqueueLinks({
               selector: '.blog-pager-older-link-mobile',
            });
            if (infos.processedRequests.length === 0) log.info(`${request.url} is the last page!`);
         }
      }
   },

   // This function is called if the page processing failed more than maxRequestRetries+1 times.
   failedRequestHandler({ request, log }) {
      log.info(`Request ${request.url} failed too many times.`);
   },
});

async function runCrawler() {
   await crawler.addRequests(['https://thehackernews.com/']);
   // Run the crawler and wait for it to finish.
   return await crawler.run();
}

runCrawler().then(finalStatistics => {
   console.log('Crawler finished with statistics:', finalStatistics);
}).catch((error) => {
   console.error('Error running crawler:', error);
});