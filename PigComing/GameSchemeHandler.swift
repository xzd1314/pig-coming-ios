import Foundation
import WebKit

class GameSchemeHandler: NSObject, WKURLSchemeHandler {
    func urlSchemeHandler(_ handler: WKURLSchemeHandler, start urlSchemeTask: WKURLSchemeTask) {}
    func urlSchemeHandler(_ handler: WKURLSchemeHandler, stop urlSchemeTask: WKURLSchemeTask) {}
}
