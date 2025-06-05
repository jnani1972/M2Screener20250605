exports.getQuery = function (name){
    return queries[name];
}

var queries = {
    get_clients: "SELECT c.id, c.name,\n" +
        "c.email, cb.name as broaker,\n" +
        "cb.config,\n" +
        "cb.access_token \n" +
        "from clients c \n" +
        "inner join client_brokers cb on cb.client_id = c.id \n" +
        "where cb.login_status = 'LOGGED_IN'",
    stocks_2_watch:"SELECT * from stocks s ",
    access_token:"SELECT value from settings where name = 'trading_access_token' ",
    update_access_token:"UPDATE settings SET value = ? where name = 'trading_access_token'"
}