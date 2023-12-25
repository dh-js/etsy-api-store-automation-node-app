require('dotenv').config();
const path = require("path");
const csv = require("csv-parser");
const express = require('express');
const fetch = require("node-fetch");
const hbs = require("hbs");
const multer = require('multer');
const fs = require('fs'); 
const fsPromises = require('fs').promises;
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const FormData = require('form-data');
const crypto = require("crypto");

puppeteer.use(StealthPlugin());

const app = express();
const { exec } = require('child_process');
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

// Defining the storage for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'database/')
    },
    filename: function (req, file, cb) {
      cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

//OAUTH Values
const base64URLEncode = (str) =>
  str
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest();

const oauthCodeVerifier = base64URLEncode(crypto.randomBytes(32));
const oauthCodeChallenge = base64URLEncode(sha256(oauthCodeVerifier));
const oauthState = Math.random().toString(36).substring(7);
const oauthRedirectUri = 'http://localhost:3003/oauth/redirect';

// Rendering `index.hbs` file.
app.get('/', async (req, res) => {
    res.render("index", {
        ETSY_CLIENT_ID: process.env.ETSY_CLIENT_ID,
        oauth_state: oauthState,
        oauth_code_challenge: oauthCodeChallenge,
        oauth_redirect_uri: oauthRedirectUri
    });
});

//ETSY AUTH PROCESS
app.get("/oauth/redirect", async (req, res) => {
    const state = req.query.state;
    // Check if the state parameter matches the set oauthState value from above
    if (state !== oauthState) {
        res.send("Error: state mismatch");
    }
    // req.query object has query params that Etsy auth sends to this route. Auth code is in `code` param
    const authCode = req.query.code;
    const requestOptions = {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: process.env.ETSY_CLIENT_ID,
            redirect_uri: oauthRedirectUri,
            code: authCode,
            code_verifier: oauthCodeVerifier
        }),
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const response = await fetch(
        'https://api.etsy.com/v3/public/oauth/token',
        requestOptions
        );

    // Extract access token from the response access_token data field
    if (response.ok) {
        const tokenData = await response.json();
        res.redirect(`/welcome?access_token=${tokenData.access_token}`);
    } else {
        res.send("oops");
    }
});

app.get("/welcome", async (req, res) => {
    const { access_token } = req.query;
    const user_id = access_token.split('.')[0];

    // requestOptions used in both requests
    const requestOptions = {
        headers: {
            'x-api-key': process.env.ETSY_CLIENT_ID,
            Authorization: `Bearer ${access_token}`,
            'Accept': 'application/json',
        }
    };

    //First fetch request
    const responseUser = await fetch(
        `https://api.etsy.com/v3/application/users/${user_id}`,
        requestOptions
    );

    let firstName;
    if (responseUser.ok) {
        const userData = await responseUser.json();
        firstName = userData.first_name;
    } else {
        console.log(responseUser.status, responseUser.statusText);
        const errorData = await responseUser.json();
        console.log(errorData);
        res.send("oops");
    }

    //Second fetch request
    const responseMe = await fetch(
        "https://openapi.etsy.com/v3/application/users/me",
        requestOptions
    )

    let shopID;
    if (responseMe.ok) {
        const meData = await responseMe.json();
        shopID = meData.shop_id;
    } else {
        console.log(responseMe.status, responseMe.statusText);
        const errorDataMe = await responseMe.json();
        console.log(errorDataMe);
        res.send("oops")
    }

    res.render("welcome", {
        first_name_hbs: firstName,
        shop_id_hbs: shopID,
        access_token_hbs: access_token
    });
    
});

app.get('/createListingsSpreadsheet', async (req, res) => {
    const { access_token, shop_id, first_name } = req.query;
    
    //Get shop category IDs first
    let shopCategoryTranslations = {};

    const requestOptionsSections = {
        method: 'GET',
        headers: {
            'x-api-key': process.env.ETSY_CLIENT_ID,
            Authorization: `Bearer ${access_token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
    };
        
    const sectionsResponse = await fetch(
        `https://openapi.etsy.com/v3/application/shops/${shop_id}/sections`,
        requestOptionsSections
        );
    
    //Creating an array of objects with the shop category IDs and their corresponding names for later use
    if (sectionsResponse.ok) {
        sectionsData = await sectionsResponse.json();
        sectionsData.results.forEach(result => {
            shopCategoryTranslations[result.shop_section_id] = result.title;
        });
    } else {
        const errorData = await listingsResponse.json();
        console.log('Error:', errorData);
    }

    //Get the listing data
    let parsedData = [];
    const limit = 100;
    let offset = 0;
    let stayInLoop = true;
    let listingCount;
    
    while (stayInLoop) {
        const requestOptions = {
            method: 'GET',
            headers: {
                'x-api-key': process.env.ETSY_CLIENT_ID,
                Authorization: `Bearer ${access_token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
        };
        
        const listingsResponse = await fetch(
            `https://openapi.etsy.com/v3/application/shops/${shop_id}/listings?state=active&limit=${limit}&offset=${offset}`,
            requestOptions
            );
        
        let listingsData;
        if (listingsResponse.ok) {
            listingsData = await listingsResponse.json();
            listingsData.results.forEach(result => {
                // Defining the listing object
                let obj = {
                    id: result.listing_id,
                    title: result.title,
                    type: shopCategoryTranslations[result.shop_section_id],
                    keyword1: null,
                    keyword2: null,
                    keyword3: null
                };
                // loop over tags and add each one to the object
                result.tags.forEach((tag, index) => {
                    obj['tag' + (index + 1)] = tag; 
                });
                
                parsedData.push(obj);
            });
        } else {
            const errorData = await listingsResponse.json();
            console.log('Error:', errorData);
        }
        listingCount = listingsData.count;
        offset = offset + 100;
        if (offset >= listingCount) {
            stayInLoop = false;
        };
    }

    let fileCounter = 0;
    let newFileName;
    let fileExists = true;

    while (fileExists) {
        newFileName = `./template_listingsData${fileCounter ? fileCounter : ''}.csv`;
        fileExists = fs.existsSync(newFileName);
        if (fileExists) fileCounter++;
    }

    const csvWriter = createCsvWriter({
        path: newFileName,
        header: [
            {id: 'id', title: 'Product ID'},
            {id: 'mockupfolder', title: 'Mockups Folder'},
            {id: 'title', title: 'Product Title'},
            {id: 'tag1', title: 'Tag 1'},
            {id: 'tag2', title: 'Tag 2'},
            {id: 'tag3', title: 'Tag 3'},
            {id: 'tag4', title: 'Tag 4'},
            {id: 'tag5', title: 'Tag 5'},
            {id: 'tag6', title: 'Tag 6'},
            {id: 'tag7', title: 'Tag 7'},
            {id: 'tag8', title: 'Tag 8'},
            {id: 'tag9', title: 'Tag 9'},
            {id: 'tag10', title: 'Tag 10'},
            {id: 'tag11', title: 'Tag 11'},
            {id: 'tag12', title: 'Tag 12'},
            {id: 'tag13', title: 'Tag 13'},
            {id: 'type', title: 'Product Type'},
            {id: 'keyword1', title: 'Fact keyword'},
            {id: 'keyword2', title: 'People keyword'},
            {id: 'keyword3', title: 'Occasion keyword'}
        ]
    });

    csvWriter
    .writeRecords(parsedData)
    .then(()=> console.log('The CSV file was written successfully'));

    res.render('welcome', {
        first_name_hbs: first_name,
        access_token_hbs: access_token,
        shop_id_hbs: shop_id,
        templateCreated: true,
        fileName: newFileName
    });
    
});

app.get('/login', async (req, res) => {
    const { access_token, shop_id, first_name } = req.query;
    try {

        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/92.0.902.84'
        ];
        
        const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        await fsPromises.writeFile('./database/userAgent.txt', randomUserAgent);

        const browser = await puppeteer.launch({ executablePath: './chromium/puppeteer/chrome/win64-114.0.5735.133/chrome-win64/chrome.exe', headless: false });
        const page = await browser.newPage();

        await page.setUserAgent(randomUserAgent);

        // Listen for "targetchanged" event
        browser.on('targetchanged', async () => {
            const cookies = await page.cookies();
            await fsPromises.writeFile('./database/cookies.json', JSON.stringify(cookies, null, 2));
            //console.log("Cookies saved.");
        });

        await page.goto('https://erank.com/login');

        // Now you manually log in
        console.log("Please log in manually, then close the browser.");

        // Wait for navigation
        await page.waitForNavigation({ timeout: 0 }); // No timeout
        
        browser.on('disconnected', async () => {
            console.log("Cookies Saved");
        });
        
        res.render('welcome', {
            first_name_hbs: first_name,
            access_token_hbs: access_token,
            shop_id_hbs: shop_id,
            loggedIn: true
        });
    } catch (error) {
        console.error(error);
    }
});

// let additionalHeaders = [
    //     { id: 'factresult1', title: 'Fact Result 1' },
    //     { id: 'factresult2', title: 'Fact Result 2' },
    //     { id: 'factresult3', title: 'Fact Result 3' },
    //     { id: 'factresult4', title: 'Fact Result 4' },
    //     { id: 'factresult5', title: 'Fact Result 5' },
    //     { id: 'peopleresult1', title: 'People Result 1' },
    //     { id: 'peopleresult2', title: 'People Result 2' },
    //     { id: 'peopleresult3', title: 'People Result 3' },
    //     { id: 'peopleresult4', title: 'People Result 4' },
    //     { id: 'peopleresult5', title: 'People Result 5' },
    //     { id: 'occasionresult1', title: 'Occasion Result 1' },
    //     { id: 'occasionresult2', title: 'Occasion Result 2' },
    //     { id: 'occasionresult3', title: 'Occasion Result 3' },
    //     { id: 'occasionresult4', title: 'Occasion Result 4' },
    //     { id: 'occasionresult5', title: 'Occasion Result 5' }
    // ];

    // Fetch the top 5 search results
                // const topResults = await page.$$eval('tr > td > a[title]', anchors => anchors.slice(0, 10).map(a => a.textContent.trim()));
                // // Add results to row
                // for (let i = 0; i < topResults.length; i++) {
                //     row['factresult' + (i + 1)] = topResults[i];
                // }

    // Fetch the top 5 search results
                // const topResults = await page.$$eval('tr > td > a[title]', anchors => anchors.slice(0, 10).map(a => a.textContent.trim()));
                // // Add results to row
                // for (let i = 0; i < topResults.length; i++) {
                //     row['peopleresult' + (i + 1)] = topResults[i];
                // }

    // Fetch the top 5 search results
                // const topResults = await page.$$eval('tr > td > a[title]', anchors => anchors.slice(0, 10).map(a => a.textContent.trim()));
                // // Add results to row
                // for (let i = 0; i < topResults.length; i++) {
                //     row['occasionresult' + (i + 1)] = topResults[i];
                // }

app.post('/scrapeErank', upload.single('csvfile'), async (req, res) => {
    const { access_token, shop_id, first_name } = req.body;
    const readFile = req.file.path;
    const cookiesString = await fsPromises.readFile('./database/cookies.json', 'utf-8');
    const cookies = JSON.parse(cookiesString);
    const userAgentString = await fsPromises.readFile('./database/userAgent.txt', 'utf-8');

    const browser = await puppeteer.launch({
        executablePath: './chromium/puppeteer/chrome/win64-114.0.5735.133/chrome-win64/chrome.exe', 
        headless: false //"new"
    });
    const page = await browser.newPage();
    await page.setUserAgent(userAgentString);
    await page.setCookie(...cookies);
    await page.goto('https://erank.com/keyword-explorer?country=USA&source=etsy', {waitUntil: 'networkidle0'});
    await page.waitForTimeout(10000);

    let headers;
    let csvWriter;
    const rowsArray = [];
    const records = []; 

    const csvStream = fs.createReadStream(readFile).pipe(csv());

    let additionalHeaders = [
        { id: 'factresults', title: 'Fact Results' },
        { id: 'peopleresults', title: 'People Results' },
        { id: 'occasionresults', title: 'Occasion Results' }
    ];

    let fileCounter = 0;
    let researchFileName;
    let fileExists = true;

    while (fileExists) {
        researchFileName = `./completed-KeywordResearch${fileCounter ? fileCounter : ''}.csv`;
        fileExists = fs.existsSync(researchFileName);
        if (fileExists) fileCounter++;
    }

    csvStream.on('data', (row) => {
        if (!headers) {
            // If headers haven't been captured yet
            headers = Object.keys(row).map((i) => ({ id: i, title: i }));
            headers = headers.concat(additionalHeaders);
            csvWriter = createCsvWriter({
                path: researchFileName,
                header: headers
            });
        }
        rowsArray.push(row);
    });

    csvStream.on('end', async () => {
        for (let row of rowsArray) {
            await page.waitForSelector('input[name="keywords"]', { timeout: 20000 });
            if (row['Fact keyword']) {
                await page.waitForFunction(
                    'document.querySelector("input[name=\'keywords\']") !== null',
                    { timeout: 20000 }
                  );
                await page.evaluate(() => {
                    const elements = document.querySelectorAll('input[name="keywords"]');
                    const element = elements[1];
                    element.value = '';
                    element.focus();
                    element.click();
                });
                await page.keyboard.type(row['Product Type'] + ' ' + row['Fact keyword']);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(10000);

                try {
                    // Fetch the top 10 search results
                    const topResults = await page.$$eval('tr > td > a[title]', anchors => anchors.slice(0, 10).map(a => a.textContent.trim()));
                    let topResultsString = topResults.join(', ');
                    row['factresults'] = topResultsString;
                } catch (error) {
                    console.error('No search results for Fact keyword', error);
                    row['factresults'] = 'No results';
                }

            }
            if (row['People keyword']) {
                await page.waitForFunction(
                    'document.querySelector("input[name=\'keywords\']") !== null',
                    { timeout: 20000 }
                  );
                await page.evaluate(() => {
                    const elements = document.querySelectorAll('input[name="keywords"]');
                    const element = elements[1];
                    element.value = '';
                    element.focus();
                    element.click();
                });
                await page.keyboard.type(row['Product Type'] + ' ' + row['People keyword']);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(10000);
                
                try {
                    // Fetch the top 10 search results
                    const topResults = await page.$$eval('tr > td > a[title]', anchors => anchors.slice(0, 10).map(a => a.textContent.trim()));
                    let topResultsString = topResults.join(', ');
                    row['peopleresults'] = topResultsString;
                } catch (error) {
                    console.error('No search results for People keyword', error);
                    row['peopleresults'] = 'No results';
                }
            }
            if (row['Occasion keyword']) {
                await page.waitForFunction(
                    'document.querySelector("input[name=\'keywords\']") !== null',
                    { timeout: 20000 }
                  );
                await page.evaluate(() => {
                    const elements = document.querySelectorAll('input[name="keywords"]');
                    const element = elements[1];
                    element.value = '';
                    element.focus();
                    element.click();
                });
                await page.keyboard.type(row['Product Type'] + ' ' + row['Occasion keyword']);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(10000);
                
                try {
                    // Fetch the top 10 search results
                    const topResults = await page.$$eval('tr > td > a[title]', anchors => anchors.slice(0, 10).map(a => a.textContent.trim()));
                    let topResultsString = topResults.join(', ');
                    row['occasionresults'] = topResultsString;
                } catch (error) {
                    console.error('No search results for Occasion keyword', error);
                    row['occasionresults'] = 'No results';
                }
            }

            console.log("Processing...");
            records.push(row);
        }

        await csvWriter.writeRecords(records);  

        await browser.close();

        console.log("CSV file successfully processed.");
        res.render('welcome', {
            first_name_hbs: first_name,
            access_token_hbs: access_token,
            shop_id_hbs: shop_id,
            erankScraped: true,
            fileName: researchFileName
        });
    });

    // Listen for errors
    csvStream.on('error', (error) => {
        console.error(`Error reading CSV file: ${error.message}`);
    });
});

app.post("/updateTitlesTagsEtsy", upload.single('csvfile'), async (req, res) => {
    const { access_token, shop_id, first_name } = req.body;
    const completedTemplateData = [];

    const readCSV = new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
            completedTemplateData.push(row);
        })
        .on('end', () => {
            console.log('CSV file successfully processed');
            resolve();
        })
        .on('error', (error) => {
            reject(error);
        });
    });

    await readCSV;

    for (let i = 0; i < completedTemplateData.length; i++) {

        const listing_id = completedTemplateData[i]['Product ID'];
        
        let tagsArray = [];
        for (let j = 1; j < 14; j++) {
            if (completedTemplateData[i]['Tag ' + j]) {
                tagsArray.push(completedTemplateData[i]['Tag ' + j]);
            }
        }
        tagsArray = tagsArray.join(',');

        let newTitle = completedTemplateData[i]['Product Title'];

        const patchRequestOptions = {
            method: 'PATCH',
            headers: {
                'x-api-key': process.env.ETSY_CLIENT_ID,
                Authorization: `Bearer ${access_token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: newTitle,
                tags: tagsArray
            })
        };

        const patchResponse = await fetch(`https://openapi.etsy.com/v3/application/shops/${shop_id}/listings/${listing_id}`, patchRequestOptions);
        if (patchResponse.ok) {
            console.log(`Successfully updated listing: ${newTitle}`);
        } else {
            console.log(`Error updating listing ${newTitle}`);
        }
        
    }

    res.render('welcome', {
        first_name_hbs: first_name,
        access_token_hbs: access_token,
        shop_id_hbs: shop_id,
        titlesTagsUpdated: true
    });

});

app.post("/updateImagesEtsy", upload.single('csvfile'), async (req, res) => {
    const { access_token, shop_id, first_name } = req.body;
    const rowsData = [];
    const csvErrorsArray = [];
    let csvCheckCounter = 1;

    const readCSV = new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
            csvCheckCounter++;
            rowsData.push(row);
            // Check if the directory exists
            const dirPath = path.join('./listing_images/', row['Mockups Folder']);
            if (!fs.existsSync(dirPath)) {
                console.log(`Directory ${dirPath} does not exist`);
                csvErrorsArray.push(`Row ${csvCheckCounter}: The folder from your spreadsheet called ${row['Mockups Folder']} does not exist within in the app's listing_images folder`);
            }
        })
        .on('end', () => {
            console.log('CSV file processed');
            resolve();
        })
        .on('error', (error) => {
            reject(error);
        });
    });

    await readCSV;

    if (csvErrorsArray.length > 0) {
        //console.log("There are errors in the CSV file. Please fix them and try again.");
        res.render("welcome", {
            first_name_hbs: first_name,
            access_token_hbs: access_token,
            shop_id_hbs: shop_id,
            csvErrorsArray: csvErrorsArray
        });
        return;
    }

    let imageRowUploadingCounter = 1;
    let imageName;
    let imageFilePath;
    let imageFolderPath;
    let imageFiles;
    let imageFileData;
    let formData;
    let image_listing_id;

    const errorsArray = [];


    for (let i = 0; i < rowsData.length; i++) {

        try {

            imageRowUploadingCounter++;

            if (rowsData[i]['Mockups Folder']) {

                console.log(`Uploading images for row ${imageRowUploadingCounter}`)

                image_listing_id = rowsData[i]['Product ID'];
                imageFolderPath = './listing_images/' + rowsData[i]['Mockups Folder'];
                //console.log(`Using image folder path: ${imageFolderPath}`);

                //Now get all of the .jpg or .png files in this folder & sort them numerically
                imageFiles = fs.readdirSync(imageFolderPath).filter(file => {
                    return file.endsWith('.jpg') || file.endsWith('.png');
                }).sort((a, b) => {
                    // Extract the leading number from the filename, convert to number and compare
                    const regex = /^\d+/;
                    const numA = Number((a.match(regex) || [])[0]);
                    const numB = Number((b.match(regex) || [])[0]);
                
                    // If either value is NaN (i.e., the filename doesn't start with a number), treat it as Infinity
                    if (isNaN(numA)) return 1;
                    if (isNaN(numB)) return -1;
                
                    return numA - numB;
                });

                //console.log(`Image files in folder: ${imageFiles}`);

                let imageUploadCounter = 0;

                for (let j = 0; j < imageFiles.length; j++) {
                    imageUploadCounter++;
                    if (imageUploadCounter === 11) {
                        break;
                    }
                    //define the image file path
                    imageFilePath = imageFolderPath + '/' + imageFiles[j];
                    imageName = imageFiles[j];
                    //console.log(`Image file data taken from: ${imageFilePath}`);
                    //console.log(`Image file uploaded with rank: ${imageUploadCounter}`);
                    //console.log(`Image file uploaded with name: ${imageName}`);
                    // Read the file to be uploaded
                    imageFileData = await fsPromises.readFile(imageFilePath);
                    // Prepare the form data
                    formData = new FormData();
                    formData.append('image', imageFileData, imageName);
                    formData.append('rank', imageUploadCounter);
                    formData.append('overwrite', 'true');

                    // Send the POST request to the Etsy API
                    const imageUploadResponse = await fetch(`https://openapi.etsy.com/v3/application/shops/${shop_id}/listings/${image_listing_id}/images`, {
                        method: 'POST',
                        headers: {
                            'x-api-key': process.env.ETSY_CLIENT_ID,
                            Authorization: `Bearer ${access_token}`,
                            ...formData.getHeaders()
                        },
                        body: formData,
                    });

                    // Handle the imageUploadResponse from the Etsy API
                    let currentImage = "image " + imageUploadCounter.toString();
                    if (imageUploadResponse.ok) {
                        const json = await imageUploadResponse.json();
                        console.log(`Successfully uploaded ${currentImage} out of ${imageFiles.length}`);
                    } else {
                        const errorData = await imageUploadResponse.json();
                        throw new Error(errorData.error);
                    }
                
                }

            }
        } catch (error) {
            console.error(error);
            const currentRow = i + 2;
            errorsArray.push(`Row ${currentRow}: There was a problem uploading the images for this row.`);
        }
    }

    //console.log(errorsArray.length)

    if (errorsArray.length > 0) {
        res.render("welcome", {
            first_name_hbs: first_name,
            access_token_hbs: access_token,
            shop_id_hbs: shop_id,
            errorsArray: errorsArray
        });
        return;
    } else {
        res.render('welcome', {
            first_name_hbs: first_name,
            access_token_hbs: access_token,
            shop_id_hbs: shop_id,
            imagesUpdated: true
        });
    }
});

// Start the server
const port = 3003;
app.listen(port, () => {
    console.log(`Hi! Go to the following link in your browser to start the app: http://localhost:${port}`);
    exec(`start http://localhost:${port}`, (err, stdout, stderr) => {
        if (err) {
            console.error(`exec error: ${err}`);
            return;
        }
    });
});