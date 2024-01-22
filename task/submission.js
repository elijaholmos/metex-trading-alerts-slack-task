const { namespaceWrapper } = require('../_koiiNode/koiiNode');
const { WebClient } = require('@slack/web-api');
const { default: axios } = require('axios');
const { Connection, PublicKey } = require('@_koi/web3.js');
const { setIntervalAsync } = require('set-interval-async/dynamic');

class Submission {
  tradingTaskLastRound = null;

  task(round) {
    console.log(`beginning task for round ${round}`);
    this.performEnvCheck(process.env);

    setIntervalAsync(async () => await this.taskLogic(), 5000);
  }

  async taskLogic() {
    try {
      console.log('beginning taskLogic');
      const ALREADY_NOTIFIED_TICKERS = new Set();
      const slack = new WebClient(process.env.SLACK_TOKEN);
      const connection = new Connection('https://testnet.koii.live');
      const accountInfo = await connection.getAccountInfo(new PublicKey(process.env.TRADING_TASK));
      const taskState = JSON.parse(accountInfo.data + '')?.submissions;
      console.log('TRADING_TASK taskState submissions', taskState);

      let mostRecentSubmission = null;
      let maxKey = -1;
      for (const key in taskState) {
        const numericKey = Number(key);
        if (numericKey > maxKey) {
          maxKey = numericKey;
          mostRecentSubmission = taskState[key];
        }
      }

      console.log('mostRecentSubmission', mostRecentSubmission);
      console.log('maxKey', maxKey);
      console.log('this.tradingTaskLastRound', this.tradingTaskLastRound);
      if (maxKey === -1) return console.log('no submissions detected');
      if (maxKey === this.tradingTaskLastRound)
        return console.log('exiting due to no new submission round detected');

      this.tradingTaskLastRound = maxKey;

      for (const wallet in mostRecentSubmission) {
        const log = (msg) => console.log(`[${this.tradingTaskLastRound}] (${wallet}) ${msg}`);

        const cid = mostRecentSubmission[wallet]?.submission_value;

        if (!cid) return log('cid is falsy');
        if (!cid?.length) return log('cid is empty string');

        const data = await getJSONFromCID(cid, 'data.json');
        log('data', data);
        if (!data) return log('no data found');
        // For unsuccessful flow we return false (Means the audited node submission is incorrect)
        // Submission value should have every key on the object
        if (!Array.isArray(data)) return log('data is not array');
        if (!data.length) return log('data is empty array');
        for (const el of data)
          if (
            !['ticker', 'initialPrice', 'price', 'delta', 'threshold', 'articles'].every((key) =>
              Object.hasOwn(el, key),
            )
          )
            return log('data elemetns failed key validation');
        log('successful data validation');

        for (const { ticker, initialPrice, price, delta, threshold, articles } of data) {
          if (ALREADY_NOTIFIED_TICKERS.has(ticker)) {
            log(`already notified for ticker ${ticker}`);
            continue;
          }
          let text = `[${ticker}]: Price change from ${initialPrice} to ${price} exceeds threshold (${
            threshold * 100
          }%): ${(delta * 100).toFixed(2)}%`;

          if (!!articles?.length)
            text += `\n\n*Possibly related articles*
            \r${articles.map(({ title, url }) => `• <${url}|${title}>`).join('\n')}
          `;
          else text += '\n\n*No related articles found*';

          await slack.chat.postMessage({
            channel: '#trading-alerts',
            text,
          });

          ALREADY_NOTIFIED_TICKERS.add(ticker);
          log(`notified for ticker ${ticker}`);
        }
      }
    } catch (err) {
      console.log('ERROR IN EXECUTING TASK', err);
      return 'ERROR IN EXECUTING TASK' + err;
    }
  }

  async submitTask(roundNumber) {
    console.log('submitTask called with round', roundNumber);
    try {
      console.log('inside submitTask try');
      console.log(await namespaceWrapper.getSlot(), 'current slot while calling submit');
      const submission = await this.fetchSubmission(roundNumber);
      console.log('SUBMISSION', submission);
      await namespaceWrapper.checkSubmissionAndUpdateRound(submission, roundNumber);
      console.log('after the submission call');
      return submission;
    } catch (error) {
      console.log('error in submission', error);
    }
  }

  async fetchSubmission(round) {
    // Write the logic to fetch the submission values here and return the cid string

    // fetching round number to store work accordingly

    console.log('IN FETCH SUBMISSION');

    // The code below shows how you can fetch your stored value from level DB

    const value = true; // retrieves the value
    console.log('VALUE', value);
    return value;
  }

  performEnvCheck(env) {
    const vars = ['SLACK_TOKEN', 'TRADING_TASK'];
    for (const key of vars) if (!env[key]) throw new Error(`Missing environment variable ${key}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getJSONFromCID = async (cid, fileName, maxRetries = 3, retryDelay = 3000) => {
  const url = `https://${cid}.ipfs.dweb.link/${fileName}`;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url);
      if (response.status === 200) {
        return response.data;
      } else {
        console.log(`Attempt ${attempt}: Received status ${response.status}`);
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed: ${error.message}`);
      console.log(error);
      if (attempt < maxRetries) {
        console.log(`Waiting for ${retryDelay / 1000} seconds before retrying...`);
        await sleep(retryDelay);
      } else {
        return false; // Rethrow the last error
      }
    }
  }
};

const submission = new Submission();
module.exports = { submission };
