/**
 * Copyright 2020 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* DialogflowStream class makes continuous streaming between Dialogflow
and the user easy. See example code at bottom */

const dialogflow = require('dialogflow');
const record = require('node-record-lpcm16');
const pump = require('pump');
const Transform = require('readable-stream').Transform;
const Speaker = require('speaker');
const { PassThrough } = require('stream');
const uuidv1 = require('uuid');
const textToSpeech = require('@google-cloud/text-to-speech');

const encoding = "LINEAR16";
const sampleRateHertz = 16000;
const languageCode = "en-US";

class DialogflowStream {

    constructor(projectId, timeout=null) {
        this.sessionClient = new dialogflow.SessionsClient();
        this.projectId = projectId;
        this.timeout = timeout;

        this.makeInitialStreamRequestArgs = function (sessionId) {
            // Initial request for Dialogflow setup
            const sessionPath = this.sessionClient.sessionPath(this.projectId, sessionId);
            return {
                session: sessionPath,
                queryInput: {
                    audioConfig: {
                        audioEncoding: encoding,
                        sampleRateHertz: sampleRateHertz,
                        languageCode: languageCode,
                    },
                    singleUtterance: true,
                },
                outputAudioConfig: {
                    audioEncoding: `OUTPUT_AUDIO_ENCODING_LINEAR_16`,
                    sampleRateHertz: sampleRateHertz,
                },
            };
        }
    }

    getAudio(sessionId) {
        const detectStream = this.sessionClient
            .streamingDetectIntent()
            .on('error', console.error)

        const recording = record
            .record({
                sampleRateHertz: sampleRateHertz,
                threshold: 0,
                verbose: false,
                recordProgram: 'sox', // Try also "arecord" or "sox"
                silence: '10.0',
            });

        const recordingStream = recording.stream()
            .on('error', console.error);

        const pumpStream = pump(
            recordingStream,
            // Format the audio stream into the request format.
            new Transform({
                objectMode: true,
                transform: (obj, _, next) => {
                    next(null, { inputAudio: obj });
                },
            }),
            detectStream
        );

        let queryResult;
        return new Promise(resolve => {
            let silent = true

            // Try to get them to say stuff
            detectStream.on('data', data => {
                if (data.recognitionResult) {
                    silent = false
                    console.log(
                        `Intermediate transcript: ${data.recognitionResult.transcript}`
                    );
                    if (data.recognitionResult.isFinal) {
                        console.log("Result Is Final");
                        recording.stop();
                    }
                }
                if (data.queryResult) {
                    console.log(`Fulfillment text: ${data.queryResult.fulfillmentText}`);
                    queryResult = data.queryResult;
                }
                if (data.outputAudio && data.outputAudio.length) {
                    resolve({"audio" : data.outputAudio, "queryResult" : queryResult});
                    pumpStream.end();
                }
            });

            detectStream.write(this.makeInitialStreamRequestArgs(sessionId));

           // ... or resolve after 5 seconds if they say nothing
           if (this.timeout) {
                setTimeout(() => {
                    if (silent) {
                        recording.stop();
                        resolve({});
                    }
                }, this.timeout);
           }
        })
    }

    playAudio(audioBuffer, channels=1) {
        return new Promise(resolve => {
            // Setup the speaker for playing audio
            const speaker = new Speaker({
                channels: channels,
                bitDepth: 16,
                sampleRate: sampleRateHertz,
            });

            speaker.on("close", () => {
                resolve();
            });

            // Setup the audio stream, feed the audio buffer in
            const audioStream = new PassThrough();
            audioStream.pipe(speaker);
            audioStream.end(audioBuffer);
        })
    }

    // Given ssml (https://developers.google.com/assistant/actions/reference/ssml),
    // calls the Text-to-Speech API and returns an audio data response.
    async tts(ssml) {
        const ttsClient = new textToSpeech.TextToSpeechClient();
        // Construct the request
        const request = {
            input: { ssml: ssml },
            voice: { languageCode: 'en-US', name: "en-US-Wavenet-D" },
            audioConfig: { audioEncoding: 'LINEAR16', sample_rate_hertz: sampleRateHertz},
        };
        const [response] = await ttsClient.synthesizeSpeech(request);
        return response["audioContent"];
    }

}

module.exports = DialogflowStream;