1. Tabs
    a. A +new always
    b. Double on sidebar to open the table in the new tab
    c. +new for writing queries/creating tables
2. Sidebar for creating connections
    -> database
        -> tables
    -> database
        -> tables
3. Option for creating dynamic views
    -> checking different things across connections

5. AI support for db adapters

4. Support for custom apis
    -> define flow
        -> auth
        -> connect
        -> action

Next -> Optimising table views(virtualisation, infinite scroll)
        Dashboard
        Datagrid for crud in the same table without query
        Query logs like warnings
        Query editor like monaco with auto completion

* A db for the application as well to store the details of the connections(sqlite)

### Handling sqlite
Sqlite -> either file or remote connections
Since local and an internal tool so lets save the file in the internal file system only(docker volumes)