import os, sys
os.chdir("/Users/yoadgolan/Documents/GitHub/FinanceAPP")
sys.argv = ["http.server", "3000"]
import http.server
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler, port=3000, bind="")
