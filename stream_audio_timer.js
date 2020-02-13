const uuidv1 = require('uuid/v1');
const DialogflowStream = require('./DialogflowStream');
//const moment = require('moment');
//const textToSpeech = require('@google-cloud/text-to-speech');
const keypress = require('keypress');
const fs = require('fs');

// Plays audioFile wav files through the speaker.
// stream is a DialogflowStream object.
async function playBuzzer(audioFile, stream) {
    console.log("Buzz buzz buzz");
    var contents = fs.readFileSync(audioFile);
    await stream.playAudio(contents, 2);
}

function setTimer(stream, duration, unit) {
    let durationMs;
    switch(unit) {
        case 's':
            durationMs = duration * 1000;
            break;
        case 'min':
            durationMs = duration * 1000 * 60;
            break;
        case 'h':
            durationMs = duration * 1000 * 60**2;
            break;
        case 'day':
            durationMs = duration * 1000 * 60**2 * 24;
            break;
        case 'year':
            durationMs = duration * 1000 * 60**2 * 24 * 365;
            break;
        default:
            return;
    }
    setTimeout(() => {playBuzzer("./alarms/spaceship_alarm.wav", stream)}, durationMs);
}

async function handleResponse(dfStream, audio, queryResult) {
    // Once Dialogflow recognizes a user's intent, this
    // function handles the response.
    //
    // `dfSteam` is passed so you can play audio with it's .playAudio method
    // `audio` is an audio buffer returned by Dialogflow
    // `queryResult` is data returned by Dialogflow, see
    // https://cloud.google.com/dialogflow/docs/reference/rpc/google.cloud.dialogflow.v2#queryresult

    const intent = queryResult.intent.displayName;
    const parameters = queryResult.parameters["fields"];

    console.log(`Recognized intent ${intent}`);
    console.log(`Parameters`, parameters);

    if (intent == "SetTimer" && parameters["duration"]) {
        const duration = parameters["duration"]["structValue"]["fields"]["amount"]["numberValue"];
        const unit = parameters["duration"]["structValue"]["fields"]["unit"]["stringValue"]; // s, min, h, day, yr
        console.log(`Duration: ${duration} unit: ${unit}`)
        setTimer(dfStream, duration, unit);
    }
    // else if (intent == YOUR_OTHER_INTENT) {
    //     // do something
    // }

    if(audio) {
        await dfStream.playAudio(audio, 1);
    }

    // The "end_conversation" flag lets us know whether we should expect
    // the user to keep speaking after we play or response or whether
    // the conversation is over and we can close the stream.
    if (queryResult.diagnosticInfo && queryResult.diagnosticInfo["fields"]["end_conversation"]) {
    	return false;
    }
    return true;
}


async function stream() {

    console.log('Listening, press Ctrl+C to stop.');

    // Create a new id for this session
    const sessionId = uuidv1();

    // Create a dialogflow stream that times out after 3 seconds
    const stream = new DialogflowStream(process.env.PROJECT_ID, 3000);

    let conversing = true;
    while (conversing) {
        const res = await stream.getAudio(sessionId);
        if (res["audio"]) {
            conversing = await handleResponse(stream, res["audio"], res["queryResult"]);
        } else {
            conversing = false;
        }
    }
}

async function main() {
	let inPress = false;
	keypress(process.stdin);
	process.stdin.on('keypress', async function (ch, key) {
		console.log("Got key press");
		if (inPress)	return;
		inPress = true;
		console.log("recording");
		await stream();
		console.log("done recording");
		inPress = false;
	    });
}

main();