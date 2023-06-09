const puppeteer = require('puppeteer');
const {parseISO, compareAsc, isBefore, format} = require('date-fns')
require('dotenv').config();

const playwright  = require('playwright');

const {delay, sendEmail, logStep} = require('./utils');
const {siteInfo, loginCred, IS_PROD, NEXT_SCHEDULE_POLL, MAX_NUMBER_OF_POLL, NOTIFY_ON_DATE_BEFORE} = require('./config');

let isLoggedIn = false;
let maxTries = MAX_NUMBER_OF_POLL

const login = async (page) => {
  logStep('logging in');
  await page.goto(siteInfo.LOGIN_URL);

  const form = await page.$("form#sign_in_form");

  const email = await form.$('input[name="user[email]"]');
  const password = await form.$('input[name="user[password]"]');
  const privacyTerms = await form.$('input[name="policy_confirmed"]');
  const signInButton = await form.$('input[name="commit"]');

  await email.type(loginCred.EMAIL);
  await password.type(loginCred.PASSWORD);
  await privacyTerms.click();
  await signInButton.click();

  await page.waitForNavigation();

  return true;
}

const notifyMe = async (earliestDate) => {
  const formattedDate = format(earliestDate, 'dd-MM-yyyy');
  logStep(`sending an email to schedule for ${formattedDate}`);
  await sendEmail({
    subject: `We found an earlier date ${formattedDate}`,
    text: `Hurry and schedule for ${formattedDate} before it is taken.`
  })
}

const notifyTriesDone = async (tries) => {
  logStep(`sending an email to schedule for ${tries}`);

  var currentDate = new Date();

  var options = { day: "numeric", month: "long", year: "numeric" };

  var currDate = currentDate.toLocaleDateString("en-US", options);

  await sendEmail({
    subject: `Tries no. ${tries} dated ${currDate}`,
    text: `code is running. :)`,
  });
};

const notifyStart = async () => {

  var currentDate = new Date();

  var options = { day: "numeric", month: "long", year: "numeric" };

  var currDate = currentDate.toLocaleDateString("en-US", options);

  await sendEmail({
    subject: `Cron started for ${currDate}`,
    text: `cron is running. :)`,
  });
};

const checkForSchedules = async (page) => {
  logStep('checking for schedules');
  await page.setExtraHTTPHeaders({
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest'
  });
  await page.goto(siteInfo.APPOINTMENTS_JSON_URL);

  const originalPageContent = await page.content();
  const bodyText = await page.evaluate(() => {
    return document.querySelector('body').innerText
  });

  try{
    console.log(bodyText);
    const parsedBody =  JSON.parse(bodyText);

    if(!Array.isArray(parsedBody)) {
      throw "Failed to parse dates, probably because you are not logged in";
    }

    const dates =parsedBody.map(item => parseISO(item.date));
    const [earliest] = dates.sort(compareAsc)

    console.log("earliest date is: ", earliest);
    return earliest;
  }catch(err){
    console.log("Unable to parse page JSON content", originalPageContent);
    console.error(err)
    isLoggedIn = false;
  }
}


const process = async (browser) => {
  logStep(`starting process with ${maxTries} tries left`);

  if(maxTries-- <= 0){
    console.log('Reached Max tries')
    return
  }

  // notifyTriesDone(maxTries);

  const page = await browser.newPage();

  if(!isLoggedIn) {
     isLoggedIn = await login(page);
  }

  const earliestDate = await checkForSchedules(page);
  if(earliestDate && isBefore(earliestDate, parseISO(NOTIFY_ON_DATE_BEFORE))){
    await notifyMe(earliestDate);
    await rescheduleAppointment(earliestDate);
  }

  await delay(NEXT_SCHEDULE_POLL)

  await process(browser)
}

const rescheduleAppointment = async (date) => {
  try {
      const browser = await playwright.chromium.launch({ headless: false, slowMo: 600});
      const page = await browser.newPage();
      await page.goto('https://ais.usvisa-info.com/en-ca/niv/users/sign_in');
      const userEmailInput = page.locator('#user_email');
      const userPasswordInput = page.locator('#user_password');
      const policyCheckbox = page.locator('#policy_confirmed');
      const loginButton = page.locator('[name=commit]');
      await userEmailInput.fill(loginCred.EMAIL);
      await userPasswordInput.fill(loginCred.PASSWORD);
      await policyCheckbox.check({ force: true });
      await loginButton.click();

      console.log("date var value: ", date);
      let deadlineDate = date;
    

      const continueButton = page.locator("'Continue'").nth(0);
      const continueUrl = await continueButton.getAttribute('href');
      const urlBase = 'https://ais.usvisa-info.com' + continueUrl.replace("continue_actions", "")
      await page.goto(urlBase + 'appointment');

      const appointmentLocationDropdown = page.locator('#appointments_consulate_appointment_facility_id');
      await appointmentLocationDropdown.selectOption({ label: siteInfo.FACILITY_NAME });

      const errorText = page.locator('#consulate_date_time_not_available');
      const isError = await errorText.isVisible();
      if (isError) {
          console.log("No appointments error");
          await browser.close();
          return;
      }

      const appointmentDateOption = page.locator('#appointments_consulate_appointment_date');
      await appointmentDateOption.click();
      const nextButton = page.locator('a.ui-datepicker-next');

      const calendars = page.locator('table.ui-datepicker-calendar >> nth=0');
      const appointmentDays = calendars.locator("[data-event=click]")
      let appointmentDay = undefined;
      let isAppointmentAvailable = false;

      let count = await appointmentDays.count();
      
      while(count == 0){
          console.log("month has 0 available dates");
          await nextButton.click();
          count = await appointmentDays.count();
      }

      console.log("month has dates avaiable");

      for (let i = 0; i < count; i++) {
          appointmentDay = appointmentDays.nth(i);
          const newAppointmentMonth = await appointmentDay.getAttribute('data-month');
          const newAppointmentYear = await appointmentDay.getAttribute('data-year');
          const newAppointmentDay = await appointmentDay.locator('a').innerHTML();
          const newAppointmentDate = new Date(newAppointmentYear, newAppointmentMonth, newAppointmentDay);
          console.log("curr date: ", deadlineDate);
          console.log("new date: ", newAppointmentDate);
          console.log("compare dates: equal? ", newAppointmentDate == deadlineDate);
          if (newAppointmentDate.getTime() === deadlineDate.getTime()) {
              console.log("New appointment date available: ", newAppointmentDate);
              console.log(newAppointmentDate);
              isAppointmentAvailable = true;
              break;
          }
      }

      if (isAppointmentAvailable) {
          const newAppointmentMonth = await appointmentDay.getAttribute('data-month');
          const newAppointmentYear = await appointmentDay.getAttribute('data-year');
          const newAppointmentDay = await appointmentDay.locator('a').innerHTML();
          const newAppointmentDate = new Date(newAppointmentYear, newAppointmentMonth, newAppointmentDay);
          
          await appointmentDay.click();
          const appointmentTimeDropdown = page.locator('#appointments_consulate_appointment_time');

          await page.waitForTimeout(1000); // Adjust the delay as needed
          appointmentTimeDropdown.selectOption({ index: 1 });
          // const rescheduleButton = page.locator('#appointments_submit');
          // await rescheduleButton.click();
          // const confirmButton = page.locator("'Confirm'");
          // await confirmButton.click();
          console.log("New appointment date booked: ", newAppointmentDate);

      } else {
          console.log("No appointments found");
      }
      //await browser.close();
  } catch (err) {
      console.log("Error: ", err);
  }
}

(async () => {
  const browser = await puppeteer.launch(!IS_PROD ? {headless: false}: undefined);

  //notifyStart();

  try{
    await process(browser);
  }catch(err){
    console.error(err);
  }

  await browser.close();
})();