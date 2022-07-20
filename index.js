const fs = require("fs");
const { join } = require("path");
const opts = require("minimist")(process.argv.slice(2), {
	string: [
		"dir",
		"port",
		"auth-user",
		"auth-pass",
	],
	integer: [
		"frequency",
		"alive-time",
	],
	boolean: [
		"same-ip-only",
	]
});

if (opts["help"]) {
	console.log(`Command Line Arguments
 --help            displays this message
 --auth-user       required user in auth header
 --auth-pass       required pass in auth header

Server side only
 --key             path to SSL key
 --cert            path to SSL certificate
 --port            port of the server
 --alive-time      how long a notification will exist for, in seconds
 --same-ip-only    only returns notifications on the same external IP

Client side only
 --listen          client side daemon
 --frequency       how to check for updates, in seconds`)
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
function notify(obj) {
	console.log("New notification");
	let title = obj.title;
	if (obj.app_name && obj.app_name != "") {
		title = obj.app_name + " - " + title;
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
			try {
				if (err.response.status == 403) {
					console.log("Forbidden, make sure to have set --auth-* arguments");
				} else {
					console.log("Unknown error");
				}
			}catch(err) {
				console.log("Unknown error");
			}
		})
	}, opts["frequency"]*1000 || 3000)

	return
}

const express = require("express");
const parser = require("body-parser");

const app = express();
app.use(parser.json());

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
	return req.connection.remoteAddress || 
		req.ip || req.headers["x-forwarded-for"];
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

app.post("/new-notification", (req, res) => {
	if (! check_auth(req.headers.authorization)) {
		res.statusCode = 403;
		return res.send();
	}

	let notification = {
		icon: "",
		text: "",
		title: "",
		app_name: "",
		sub_text: "",
		sub_title: ""
	, ...req.body};

	let id = get_id();
	notifications[id] = {
		icon: notification.icon,
		text: notification.text,
		title: notification.title,
		app_name: notification.app_name,
		sub_text: notification.sub_text,
		sub_title: notification.sub_text,
	}

	if (opts["same-ip-only"]) {
		notifications[id].ip = get_ip(req);
	}

	console.log(notifications)

	setTimeout(() => {
		delete notifications[id];
	}, opts["alive-time"]*1000 || 10000)

	res.statusCode = 200;
	return res.send();
})

app.get("/notifications", (req, res) => {
	if (! check_auth(req.headers.authorization)) {
		res.statusCode = 403;
		console.log("no")
		return res.send();
	}

	if (opts["same-ip-only"]) {
		let new_notifications = {};
		for (let i in notifications) {
			if (notifications[i].ip == get_ip(req)) {
				new_notifications[i] = notifications[i];
				delete new_notifications[i].ip;
			}

		}

		res.statusCode = 200;
		return res.send(new_notifications);
	}

	res.statusCode = 200;
	return res.send(notifications);
})

app.get("/status", (req, res) => {
	res.statusCode = 200;
	return res.send();
})

let http = app;

let port = opts["port"] || "7331";
if (opts["cert"] && opts["key"]) {
	const https = require("https");
	http = https.createServer({
		key: fs.readFileSync(opts["key"], "utf8"),
		cert: fs.readFileSync(opts["cert"], "utf8")
	}, app)
} else {
}

http.listen(port, () => {
	console.log("Mitto server started on:", port);
});
