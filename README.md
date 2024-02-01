### What is Mitto?

Mitto by itself is a very tiny and simple notification server
specification, node-mitto specifically is one implementation of that,
essentially you make simple HTTP `POST` requests to the server, a client
makes simple `GET` requests to that server and then displays
notifcations if there are any.

### How does it work?

The Mitto spec is very simple, `GET <server>/status` should always
return status code `200` and nothing else.

`GET <server>/notifications` should return a simple JSON Object with the
current notifications. Seen below:

```json
{
	"<uuid of notification>": {
		"icon": "",
		"text": "",
		"title": "",
		"app_id": "",
		"app_name": "",
		"sub_text": "",
		"sub_title": ""
	}
}
```

The properties are very obvious. To make new notifications make a `POST
<server>/new-notification` request, with a `application/json`
Content-Type, and the body should just be the Object above, the
notification Object itself, and not with the UUID, that would be created
by the server.

UUIDs should never appear more than once, meaning the server should keep
track of used UUIDs, albeit, they're UUIDs so the chance of a collision
is small. Along with this the server should flush the notifications
every so often, however the client should keep track of which
notifications it has already displayed, as to not display them twice.

A server may also require authorization through the `Authorization`
header, the setup/format for this can vary. In the case of node-mitto,
it'll be `<auth-user>:<auth-pass>`, however this may very well first be
encoded to Base64 on other implementations.

### Using `node-mitto`

`node-mitto` is very simple, simply clone the repo, run `npm i`, then
run the `index.js` with `node index.js`, and options will be found in
the help menu (`--help`). Using `--listen` enables the client mode.

But default values are also displayed below.

#### Global options

| Option        | Description | Default |
|---------------|----------------------------|---------|
| `--auth-user` | Required username          | not set |
| `--auth-pass` | Required password          | not set |
| `--icons-dir` | Path to store cached icons | `<OS temp dir>/mitto-icons` |

#### Server side only

| Option            | Description | Default |
|-------------------|-------------|---------|
| `--key`           | Path to SSL key | not set |
| `--cert`          | Path to SSL certificate | not set |
| `--port`          | Port which the server runs on | `7331` |
| `--alive-time`    | How long before a notification gets flushed, in seconds | `10` |
| `--same-ip-only`  | Only return notifications made on the same external IP | not set |
| `--rate-limit`    | Request count before you get rate limited | `100` |
| `--rate-duration` | How long does the rate limit last, in seconds | `60` |
| `--proxy-icons`   | Should icons be downloaded and proxied through the server  | `60` |

#### Client side only

| Option        | Description | Default |
|---------------|-------------|---------|
| `--listen`    | Full URL to a Mitto instance | not set |
| `--frequency` | How often should new notifications be checked for, in seconds | `3` |
| `--icons`     | Enables icons in notification, use `--no-icons` to disable | enabled |
