const axios = require("axios");
const join = require("path").join;
const fs = require("fs").promises;
const cheerio = require("cheerio");

const opts = require("minimist")(process.argv.slice(2), {
	string: ["icons-dir"],
	boolean: ["proxy-icons"],
	default: {
		"proxy-icons": true,
		"icons-dir": join(require("os").tmpdir(), "mitto-icons")
	}
});

let icon = {
	// this is the order in which `icon.get()` will go
	priorities: [
		"fdroid",
		"appstore",
		"playstore",
		"izzydroid"
	]
}

icon.fdroid = async (app_id) => {
	let endpoint = "https://f-droid.org" +
		"/en/packages/" + app_id;

	let page;

	// attempt to request page, and start `cheerio()` on the HTML
	try {
		page = (await axios.get(endpoint)).data;
		page = cheerio.load(page);
	}catch(err) {
		return false;
	}

	// attempt to get `src` property of icon element
	let icon = page(".package-icon")["0"].attribs.src;

	// was the `src` property found?
	if (icon) {
		// we likely received the default icon, which is a relative path
		if (! icon.startsWith("http")) {
			return false;
		}

		return icon;
	}

	return false;
}

icon.izzydroid = async (app_id) => {
	let endpoint = "https://apt.izzysoft.de" +
		"/fdroid/repo/" + app_id + "/en-US/icon.png";

	// attempt to request headers for icon
	try {
		(await axios.head(endpoint)).data;
	}catch(err) { // icon doesn't exist
		return false;
	}

	return endpoint;
}

icon.playstore = async (app_id) => {
	let endpoint = "https://play.google.com" +
		"/store/apps/details?id=" + app_id;

	let page;

	// attempt to request page, and start `cheerio()` on the HTML
	try {
		page = (await axios.get(endpoint)).data;
		page = cheerio.load(page);
	}catch(err) {
		return false;
	}

	// attempt to get `src` property of icon element
	let icon_src = page("[alt='Icon image']")["0"].attribs.src;

	// if `src` property was found, return it
	if (icon_src) {
		return icon_src;
	}

	// no icon was found
	return false;
}

// attempts to use Apple's iTunes API to search for apps, then we'll
// attempt to match them to the requested `app_id` and if found, get the
// icon and return that, otherwise return `false`
icon.appstore = async (app_id) => {
	let endpoint = "https://itunes.apple.com" +
		"/search?limit=10&media=software&term=" + app_id;

	let results;

	// attempt to get search results from API
	try {
		results = (await axios.get(endpoint)).data.results;
	}catch(err) {
		// something went wrong!
		return false;
	}

	// normalize `app_id`
	app_id = app_id.toLowerCase();

	// run through search results
	for (let i = 0; i < results.length; i++) {
		// if a result's bundle ID matches `app_id` when normalized,
		// return it's icon
		if (results[i].bundleId.toLowerCase() == app_id) {
			return results[i].artworkUrl512;
		}
	}

	// no icon was found
	return false;
}

// attempts to return an icon by going through all the values in
// `icon.priorities[]`, if no icon is found `false` is returned
icon.get = async (app_id) => {
	let cached_file = await icon.get_file(app_id);

	// have we already downloaded this and is proxying icons enabled?
	// then we simply return the path
	if (cached_file && opts["proxy-icons"]) {
		return "local://" + app_id;
	}

	// check if a file with `app_id` exists in `icon_dir`, and if so,
	// return an API endpoint that'll let you download that
	try {
		// attempt to `.stat()` the file with a normalized `app_id`
		let is_file = (
			await fs.stat(join(icon_dir, app_id.toLowerCase()))
		).isFile();

		// it's a file! return the URL
		if (is_file) {
			return app_id;
		}
	}catch(err) {
		// this is a fine, this just means it's not a file or similar
	}

	// run through `icon.priorities[]` and attempt to run the respective
	// function for the value in the priority, if an icon is resolved,
	// return that
	for (let i = 0; i < icon.priorities.length; i++) {
		let icon_url;

		// attempt to run icon function
		try {
			icon_url = await icon[icon.priorities[i]](app_id);
		}catch(err) {
			// skip to next function if an error happened
			continue;
		}

		// make sure we actually got back a string, and if so return it
		if (typeof icon_url == "string") {
			let proxy_url;

			// if proxying icons is enabled, we'll download the icon
			// first, then return the endpoint for getting the proxied
			// icon, instead of the direct icon
			if (opts["proxy-icons"]) {
				let download = await icon.download(app_id, icon_url);
				if (download) {
					proxy_url = "local://" + app_id;
				}
			}

			return proxy_url || icon_url;
		}
	}

	// no icon could be found
	return false;
}

icon.get_file = async (app_id) => {
	let icon_path = join(icon_dir, app_id.toLowerCase());

	try {
		// attempt to `.stat()` the file with a normalized `app_id`
		let is_file = (
			await fs.stat(icon_path)
		).isFile();

		// it's a file! return the URL
		if (is_file) {
			return icon_path;
		}
	}catch(err) { // icon likely doesn't exist
		return false;
	}

	return icon_path;
}

let icon_dir = opts["icons-dir"];
icon.download = async (app_id, url) => {
	let cached_file = await icon.get_file(app_id);

	// have we already downloaded this? simply return the path
	if (cached_file) {
		return cached_file;
	}

	// normalize `app_id`
	app_id = app_id.toLowerCase();

	// attempt to create folder to store icons
	await fs.mkdir(icon_dir, {
		recursive: true
	})

	let image;

	// attempt to download image
	try {
		image = (await axios.get(url, {
			responseType: "arraybuffer"
		})).data;
	}catch(err) { // download failed or alike
		return false;
	}

	let icon_path = join(icon_dir, app_id);
	// attempt to write image to file
	try {
		fs.writeFile(icon_path, image);
	}catch(err) { // writing to file failed
		return false;
	}

	// everything worked!
	return icon_path;
}

module.exports = icon;
