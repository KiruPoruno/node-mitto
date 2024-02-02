const fs = require("fs");
const { join } = require("path");
const opts = require("minimist")(process.argv.slice(2), {
	string: [
		"port",
		"auth-user",
		"auth-pass",
	],
	integer: [
		"frequency",
		"alive-time",
		"rate-limit",
		"rate-duration",
	],
	boolean: [
		"icons",
		"https-icons",
		"same-ip-only",
		"x-forward-ip"
	],
	default: {
		"icons": true,
		"frequency": 3,
		"alive-time": 10,
		"rate-limit": 100,
		"rate-duration": 60,
		"https-icons": false,
		"x-forward-ip": false
	}
});

const icon = require("./icon");

if (opts["help"]) {
	console.log(`General
 --help            displays this message
 --auth-user       required user in auth header
 --auth-pass       required pass in auth header
 --icons-dir       where to store cached icons

Server side only
 --key             path to SSL key
 --cert            path to SSL certificate
 --port            port of the server
 --alive-time      how long a notification will exist for, in seconds
 --same-ip-only    only returns notifications on the same external IP
 --rate-limit      how many requests can be made before rate limiting
 --rate-duration   how long will the rate limit last
 --x-forward-ip    enables the X-Forwarded-From header which may be
                   needed for proxies, as this can be overwritten by the
                   client, if not needed it should not be enabled, as a
                   client may pretend to have a different IP, allowing
                   them to see different notifications
 --proxy-icons     should icons be downloaded and proxied to the client
 --https-icons     forces proxied icons to be delivered over HTTPS, use
				   this if the protocol auto detection is incorrectly
				   using HTTP

Client side only
 --listen          client side daemon
 --frequency       how to check for updates, in seconds
 --icons           enable icons in notifications, use --no-icons to
                   disable the icons`)
	process.exit(0);
}

let notification_list = [];
function parse_notifications(obj) {
	for (let i in obj) {
		if (! notification_list.includes(i)) {
			notification_list.push(i);

			notify(obj[i]);
		}
	}
}

let notifier = require("node-notifier");
async function notify(obj) {
	console.log("New notification");

	let title = obj.title;
	if (obj.app_name && obj.app_name != "") {
		title = obj.app_name + " - " + title;
	}

	let md5 = (text) => {
		let hmac = require("crypto").createHmac("md5", text);
		return hmac.digest("hex");
	}

	if (obj.icon && opts["icons"]) {
		let icon_path = md5(obj.icon);
		obj.icon = await icon.download(icon_path, obj.icon);
	}

	notifier.notify({
		title: title,
		icon: obj.icon,
		message: obj.text,
		sub_title: obj.sub_title
	})
}

if (opts["listen"]) {
	let axios = require("axios");

	console.log("Listening for notifications...");

	setInterval(() => {
		axios.get(opts["listen"] + "/notifications", {
			headers: {
				Authorization: opts["auth-user"] + ":" + opts["auth-pass"]
			}
		}).then((res) => {
			parse_notifications(res.data);
		}).catch((err) => {
			console.log(err);
			try {
				if (err.response.status == 403) {
					console.log("Forbidden, make sure to have set --auth-* arguments");
				} else {
					console.log("Unknown error");
					console.log(err);
				}
			}catch(err) {
				console.log("Unknown error");
				console.log(err);
			}
		})
	}, opts["frequency"]*1000)

	return
}

const express = require("express");
const parser = require("body-parser");
const rate_limiter = require("express-rate-limit");

const app = express();
app.use(parser.json());

const rate_limit = rate_limiter({
	max: opts["rate-limit"],
	windowMs: opts["rate-duration"]*1000
})

if (opts["rate-limit"] > 0) {
	app.use(rate_limit);
}

let used_ids = [];
let notifications = {};

const uuid = require("crypto").randomUUID;
let get_id = () => {
	let tmp_id = uuid();
	while (used_ids.includes[tmp_id]) {
		tmp_id = uuid();
	}

	return tmp_id;
}

let get_ip = (req) => {
	if (req.headers["x-forwarded-for"]) {
		req.headers["x-forwarded-for"] = req.headers["x-forwarded-for"].split(", ")[0];
	}

	if (! opts["x-forward-ip"]) {
		req.headers["x-forwarded-for"] = false;
	}

	return req.headers["x-forwarded-for"] ||
		req.connection.remoteAddress || req.ip;
}

let auth_text = Buffer.from(opts["auth-user"] + ":" + opts["auth-pass"]).toString("base64");
let check_auth = (auth_header) => {
	if (! opts["auth-user"] || ! opts["auth-pass"]) {
		return true;
	}

	if (! auth_header) {return false}

	if (Buffer.from(auth_header).toString("base64") == auth_text) {
		return true;
	}

	return false;
}

app.post("/new-notification", async (req, res) => {
	if (! check_auth(req.headers.authorization)) {
		res.statusCode = 403;
		return res.send();
	}

	let notification = {
		icon: "",
		text: "",
		title: "",
		app_id: "",
		app_name: "",
		sub_text: "",
		sub_title: ""
	, ...req.body};

	let id = get_id();

	let app_id_icon;
	if (notification.app_id) {
		app_id_icon = await icon.get(notification.app_id);
	}

	notifications[id] = {
		text: notification.text,
		title: notification.title,
		app_id: notification.app_id,
		app_name: notification.app_name,
		sub_text: notification.sub_text,
		sub_title: notification.sub_text,
		icon: notification.icon || app_id_icon,
	}

	if (opts["same-ip-only"]) {
		notifications[id].ip = get_ip(req);
	}

	setTimeout(() => {
		delete notifications[id];
	}, opts["alive-time"]*1000)

	res.statusCode = 200;
	return res.send();
})

app.get("/notifications", (req, res) => {
	if (! check_auth(req.headers.authorization)) {
		res.statusCode = 403;
		return res.send();
	}


	let notifs = {...notifications};

	for (let i in notifs) {
		if (typeof notifs[i].icon !== "string") {
			continue;
		}

		let app_id = notifs[i].icon.replace("local://", "");

		// auto detect the protocol
		let protocol = req.protocol;

		// force `protocol` to be HTTPS
		if (opts["https-icons"]) {
			protocol = "https"
		}

		notifs[i].icon = notifs[i].icon.replace(
			"local://",

			// as an example, this may end up being:
			//   http://localhost:7331/icon/
			//
			// then the app ID is added at the end, due to only
			// replacing the `local://` part, leaving the app ID
			protocol + "://" + req.headers.host + "/icon/"
		)
	}

	if (opts["same-ip-only"]) {
		let new_notifs = {};
		for (let i in notifs) {
			if (notifs[i].ip == get_ip(req)) {
				new_notifs[i] = {...notifs[i]};
				delete new_notifs[i].ip;
			}
		}

		res.statusCode = 200;
		return res.send(new_notifs);
	}

	res.statusCode = 200;
	return res.send(notifs);
})

app.get("/status", (req, res) => {
	res.statusCode = 200;
	return res.send();
})

app.get("/icon/:app_id", async (req, res) => {
	let app_id = req.params.app_id;
	let file = await icon.get_file(app_id);

	if (! file) {
		res.statusCode = 404;
		return res.send();
	}

	return res.sendFile(file);
})

let http = app;

let port = opts["port"] || "7331";
if (opts["cert"] && opts["key"]) {
	const https = require("https");
	http = https.createServer({
		key: fs.readFileSync(opts["key"], "utf8"),
		cert: fs.readFileSync(opts["cert"], "utf8")
	}, app)
}

http.listen(port, () => {
	console.log("Mitto server started on:", port);
});
