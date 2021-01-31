const puppeteer = require('puppeteer');
const _ = require('lodash');
const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const cheerio = require('cheerio');
const fs = require('fs');

const Stream = require('stream');
const readline = require('readline');
const dbSourceSet = new Set();
const loggers = winston.createLogger({
  level: 'error',
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: 'error.log' })],
});
const DB = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({
      filename: `${path.join(__dirname, `/data`)}/db_source.log`,
    }),
  ],
});

const ROOT_URL_PAGE =
  'https://www.icanvas.com/?fc=module&module=icacanvas&controller=list&ajax=true&query=style/renaissance&base_query=style/renaissance&active_category_query_full=[]&product=split_canvas&start=50&items=';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getObjectFromLog(data) {
  try {
    return JSON.parse(data);
  } catch (e) {
    console.log(e);
    return false;
  }
}

const getFileDataByLine = (filePath, cbFn) => {
  if (!fs.existsSync(filePath)) {
    // console.log('FILE NOT EXIST');
    return 0;
  }
  let inStream = fs.createReadStream(filePath);
  let outStream = new Stream();
  return new Promise((resolve, reject) => {
    let rl = readline.createInterface(inStream, outStream);
    rl.on('line', function (line) {
      cbFn(line);
    });

    rl.on('error', function (err) {
      console.log(err);
    });

    rl.on('close', function () {
      resolve('');
    });
  });
};

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:64.0) Gecko/`201`00101 Firefox/64.0',
  'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/17.17134',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:64.0) Gecko/20100101 Firefox/64.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36',
  'Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:64.0) Gecko/20100101 Firefox/64.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:64.0) Gecko/20100101 Firefox/64.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.0 Safari/537.36',
];

const fetchPage = async ({ query, start, userAgents }) => {
  try {
    const params = new URLSearchParams({
      fc: 'module',
      module: 'icacanvas',
      controller: 'list',
      ajax: 'true',
      active_category_query_full: '[]',
    });
    params.append('start', start);
    params.append('query', query);
    params.append('base_query', query);
    const res = await fetch(`https://www.icanvas.com/?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'accept-encoding': 'gzip, deflate, br',
        'user-agent':
          userAgents[Math.floor(Math.random() * 1000) % userAgents.length],
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      },
    });
    if (res.status < 200 || res.status >= 300) return { status: res.status };
    return res.text();
  } catch (error) {
    console.log('error  ', error);
    throw error;
  }
};

async function doJob() {
  let browser = null;
  let page = null;
  try {
    browser = await puppeteer.launch({
      headless: false,
    });
    page = await browser.newPage();
    // await sleep(10000);
    page.setDefaultNavigationTimeout(0);

    await page.setUserAgent(
      userAgents[Math.floor(Math.random() * 1000) % userAgents.length]
    );
    const url = `https://${process.argv[2]}?`;
    const inputUrl = url
      .substring(url.lastIndexOf('https://') + 8, url.indexOf('?') - 1)
      .split('/');
    const query = `${inputUrl[2] === 'tag' ? 'subject' : inputUrl[2]}/${
      inputUrl[3]
    }`;
    console.log('Start page');
    await page.goto(ROOT_URL_PAGE);

    console.log('query: ', query);
    for (let i = 1; i <= 2; i++) {
      const res = await page.evaluate(fetchPage, {
        query: 'style/modern-decor',
        start: i * 50,
        userAgents,
      });
      const selector = cheerio.load(res);
      if (selector('body').find('.canvas').length <= 0) {
        // STOP CRAWL -- DATA IS EMPTY
        console.log('EMPTY PAGE - DATA');
        return;
      }
      selector('body')
        .find('.canvas')
        .each((_, element) => {
          const url = selector(element).attr('href');
          const productId = selector(element).attr('data-history-target');
          if (url && productId && !dbSourceSet.has(productId)) {
            dbSourceSet.add(productId);
            DB.info({
              productId,
              url,
            });
          }
        });

      await sleep(10000);
    }
  } catch (error) {
    console.log(error);
    loggers.error({
      error: error.toString(),
    });
  } finally {
    page && page.close();
    browser && browser.close();
  }
}

(async () => {
  await getFileDataByLine(
    `${path.join(__dirname, `/data`)}/db_source.log`,
    (line) => {
      const p = getObjectFromLog(line);
      if (p.message.productId) {
        dbSourceSet.add(p.message.productId);
      }
    }
  );
  await doJob();
  console.log('FINISH');
})();
