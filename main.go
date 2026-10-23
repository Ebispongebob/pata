package main

import (
	"embed"
	"log"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed assets/branding/tray/tray.png
var trayIcon []byte

func main() {
	vaultService := NewVaultService()
	windowService := newWindowService(vaultService)
	mcpService := newMCPService(vaultService)

	app := application.New(application.Options{
		Name:        "Pata",
		Description: "Personal task and note workspace",
		Services: []application.Service{
			application.NewService(vaultService),
			application.NewService(windowService),
			application.NewService(mcpService),
		},
		ShouldQuit: windowService.shouldQuit,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.HasPrefix(r.URL.Path, "/vault-audio/") {
						relPath := strings.TrimPrefix(r.URL.Path, "/vault-audio/")
						absPath, err := vaultService.resolveSafeFilePath(relPath)
						if err != nil {
							http.NotFound(w, r)
							return
						}
						http.ServeFile(w, r, absPath)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Configure macOS standard application menu
	appMenu := application.DefaultApplicationMenu()
	app.Menu.SetApplicationMenu(appMenu)

	windowService.app = app
	windowService.showMainWindow()

	// Configure static system tray
	tray := app.SystemTray.New()
	tray.SetTemplateIcon(trayIcon)
	tray.SetTooltip("Pata")
	tray.OnClick(func() { go windowService.showMainWindow() })

	err := app.Run()
	if err != nil {
		log.Fatal(err)
	}
}
