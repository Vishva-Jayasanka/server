const express = require('express');
const router = express.Router();
const ObjectID = require('mongodb').ObjectID;

const Errors = require('../errors/errors');
const User = require('../models/user');
const Module = require('../models/module');
const LectureHour = require('../models/lecture-hour');
const verifyToken = require('../modules/user-verification').VerifyToken;


function verifyAdmin(request, response, next) {
    if (request.user.role === 'admin') {
        next();
    } else {
        return response.status(401).send(Errors.unauthorizedRequest);
    }
}

function convertTime(time) {
    return parseInt(time.split(':')[0]) * 60 + parseInt(time.split(':')[1]);
}

router.post('/get-teachers', verifyToken, verifyAdmin, (request, response) => {
    User.find({role: 'teacher'}, {_id: 0, username: 1, firstName: 1, lastName: 1}, (error, teachers) => {
        if (error) {
            response.status(500).send(Errors.serverError);
        } else {
            response.status(200).send({
                status: true,
                teachers: teachers
            })
        }
    });
});

router.post('/edit-module', verifyToken, verifyAdmin, (request, response) => {

    const info = request.body.moduleDetails;
    info.lectureHours.forEach(lectureHour => {
        lectureHour.startingTime = convertTime(lectureHour.startingTime);
        lectureHour.endingTime = convertTime(lectureHour.endingTime);
    });

    LectureHour.bulkWrite(info.lectureHours.map(entry => ({
            updateOne: {
                filter: {_id: ObjectID(entry.id)},
                update: {$set: entry}
            }
        })), (error, status) => {
            if (!error) {
                console.log(status);
            } else {
                console.error(error);
            }
        }
    )


});

module.exports = router;
