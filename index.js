const express = require('express');
const fs = require('fs');
const path = require('path');
const freeport = require('freeport');
const ProxyChain = require('proxy-chain');
const puppeteer = require('puppeteer-extra');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const { CookieJar } = require('tough-cookie');
const { FileCookieStore } = require('tough-cookie-file-store');

const app = express();
const screenshotPath = path.join(__dirname, 'screenshot.jpg');
const cookiesPath = path.join(__dirname, 'cookies.txt');
const email = process.env.EMAIL;
const password = process.env.PASSWORD;
const CAPTCHA_API_KEY = "9ef8ccb1a940127ba54e5c9111656506";

puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: CAPTCHA_API_KEY,
    },
    visualFeedback: true,
  })
);

const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
const mobileViewport = {
  width: 375,
  height: 812,
  isMobile: true,
  hasTouch: true,
  isLandscape: false,
};

let browser, page;

async function saveCookiesToFile(cookies, filePath) {
  const cookieJar = new CookieJar(new FileCookieStore(filePath));
  await cookieJar.setCookie(cookies);
  console.log('Cookies saved to', filePath);
}

async function initializeBrowser(proxyPort) {
  try {
    const { stdout: chromiumPath } = await promisify(exec)("which chromium");

    browser = await puppeteer.launch({
      headless: false,
      executablePath: chromiumPath.trim(),
      ignoreHTTPSErrors: true,
      args: [
        '--ignore-certificate-errors',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        `--proxy-server=127.0.0.1:${proxyPort}`
      ]
    });

    browser.on('disconnected', async () => {
      console.log('Browser disconnected, attempting to reconnect...');
      await initializeBrowser(proxyPort);
    });

    page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport(mobileViewport);
  } catch (error) {
    console.error('Error initializing browser:', error);
    process.exit(1);
  }
}

async function run() {
  try {
    freeport(async (err, proxyPort) => {
      if (err) {
        console.error('Error finding free port:', err);
        return;
      }

      const proxyServer = new ProxyChain.Server({ port: proxyPort });

      proxyServer.listen(async (proxyServerErr) => {
        if (proxyServerErr) {
          console.error('Error starting proxy server:', proxyServerErr);
          return;
        }

        console.log(`Proxy server started on port ${proxyPort}`);

        await initializeBrowser(proxyPort);

        if (fs.existsSync(cookiesPath)) {
          console.log('Loading cookies from file...');
          const cookies = fs.readFileSync(cookiesPath, 'utf8');
          const cookiesParsed = JSON.parse(cookies);
          await page.setCookie(...cookiesParsed);
        } else {
          try {
            await page.goto('https://replit.com/login', { waitUntil: 'networkidle2' });

            await page.type('input[name="username"]', email);
            await page.type('input[name="password"]', password);
            await page.click('button[data-cy="log-in-btn"]');

            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });

            if (page.url() === 'https://replit.com/~') {
              const cookies = await page.cookies();
              fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
              console.log('Cookies saved to', cookiesPath);
            } else {
              throw new Error('Failed to log in or redirected to an unexpected page.');
            }
          } catch (e) {
            console.log('Error during login:', e.message);
            const { captchas, solved, error } = await page.solveRecaptchas();

            if (error) {
              console.error('Failed to solve captcha:', error);
            } else if (solved.length > 0) {
              console.log('reCAPTCHA solved, attempting login again.');
              await page.click('button[data-cy="log-in-btn"]');
              await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
              if (page.url() === 'https://replit.com/~') {
                const cookies = await page.cookies();
                fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
                console.log('Cookies saved to', cookiesPath);
              }
            } else {
              console.log('Manual reCAPTCHA solving required.');
              try {
                await page.waitForSelector('button[data-cy="log-in-btn"]', { timeout: 0 });
                await page.click('button[data-cy="log-in-btn"]');
                await page.waitForNavigation({ waitUntil: 'networkidle2' });
                if (page.url() === 'https://replit.com/~') {
                  const cookies = await page.cookies();
                  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
                  console.log('Cookies saved to', cookiesPath);
                }
              } catch (e) {
                console.error('Error waiting for login button:', e.message);
              }
            }
          }
        }

    const currentUrl = process.env.URL;
        await page.goto(currentUrl, { waitUntil: 'networkidle2' });

        await page.screenshot({ path: screenshotPath, type: 'jpeg' });

        console.log('Browser is running. Press Ctrl+C to exit.');
      });
    });
  } catch (err) {
    console.error('Error during execution:', err);
  }
}

app.get('/ss', (req, res) => {
  res.sendFile(screenshotPath);
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

run();
