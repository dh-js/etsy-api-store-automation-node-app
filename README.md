# Etsy Automation App

This is a Node.js application designed to automate various tasks related to managing an Etsy store. It fetches data from Etsy's API, processes CSV files, performs web scraping, and generates output files based on user inputs.

## Features

- **OAuth Authentication with Etsy**: The app uses OAuth for authenticating with Etsy's API.
- **CSV File Processing**: The app processes CSV files to create templates, update listing titles and tags, and display scraped keyword data.
- **Web Scraping with Puppeteer**: The app uses Puppeteer for web scraping, logging into eRank and scraping keyword data.
- **File Uploads with Multer**: The app handles file uploads, accepting CSV files from the user for processing.
- **Image Uploads to Etsy**: The app uploads images to Etsy listings as binary data. It reads image files from a specified directory, and uploads them to the corresponding Etsy listings.
- **Updating Etsy Listings**: The app updates Etsy listings with new titles and tags. It reads this data from the completed (previously created) CSV template file.
- **Template Rendering with Handlebars**: The app uses Handlebars to render HTML templates, displaying dynamic data to the user.
- **Application Packaging with pkg**: The app is packaged into an executable file using [pkg], allowing it to be distributed and run as a standalone executable.

## How it Works

The application is initiated by a GET request to various endpoints, depending on the task to be performed. These requests are made through the browser interface, where the user can specify the necessary inputs.

The application fetches data from Etsy's API, processes CSV files, performs web scraping, and generates output files. The output files are written to the `./spreadsheets/` directory.

Scraped keywords are output into a created .csv file.

For image uploads, the application reads image files from the `./listing_images/` directory. It then uploads these images to the corresponding Etsy listings using Etsy's API.

For updating Etsy listings, the application reads a CSV file containing new titles and tags for each listing. It then uses Etsy's API to update the listings with this new data.

The user interface is rendered using Handlebars. After each task is completed, a success message is displayed on the page.

## Running the App

The application is packaged into a portable executable file using pkg. This allows the client to run the app on their PC as needed.

## Dependencies

The application uses the following dependencies:

- csv-parser
- csv-writer
- dotenv
- express
- hbs
- multer
- node-fetch
- puppeteer
- puppeteer-extra
- puppeteer-extra-plugin-stealth

## Note

Sensitive information such as API keys are stored in a `.env` file which is ignored by Git.