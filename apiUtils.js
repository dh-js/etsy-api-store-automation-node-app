const fetch = require('node-fetch');

async function videoApiCall(url, access_token, videoFormData, retries = 3) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'x-api-key': process.env.ETSY_CLIENT_ID,
                Authorization: `Bearer ${access_token}`,
                ...videoFormData.getHeaders()
            },
            body: videoFormData,
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return "Success";

    } catch (error) {
        console.error(`Failed API call for ${url}: ${error}`);
        if (retries > 0) {
            console.log(`Retrying API call for ${url}, (${retries} attempts left)...`);
            return videoApiCall(url, access_token, videoFormData, retries - 1);
        } else {
            console.error(`No more retries left for ${url}`);
            return "Failed";
        }
    }
}

module.exports = videoApiCall;