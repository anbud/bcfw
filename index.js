const wrapper = obj => {
    let callback = null

    if (typeof obj === 'function') {
        callback = obj
    } else {
        callback = (req, cb) => {
            cb(null, obj)
        }
    }

    return (req, res, next) => {
        callback(req, (err, options) => {
            if (err) {
                next(err)
            } else {
            }
        })
    }
}

module.exports = wrapper
