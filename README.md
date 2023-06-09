# US-visa-rescheduler

This is just a script I put together to check and notify me via email ([MailGun](https://www.mailgun.com/)) when there's an earlier date before my initial appointment date. It also handles rescheduling.


```
$ npm start


## How it works

* Logs you into the portal
* checks for schedules by day 
* If there's a date before your initial appointment, it notifies you via email
* If no dates found, the process waits for set amount of seconds to cool down before restarting and will stop when it reaches the set max retries.
* reschedules if earlier appointment available.

> see `config.js` or `.env.example` for values you can configure

## Configuration

use `.env` and replace the values.

### MailGun config values 

You can create a free account with https://www.mailgun.com/ which should be sufficient and use the provided sandbox domain on your dashboard. The `MAILGUN_API_KEY` can be found in your Mailgun dashboard, it starts with `key-xxxxxx`. You'll need to add authorised recipients to your sandbox domain for free accounts


## How to use it

* clone the repo 
* run `npm i` within the cloned repo directory
* start the process with `npm start`


