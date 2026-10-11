package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	application.RegisterEvent[string]("time")
}

func main() {
	spikeService := NewSpikeService()
	greetService := &GreetService{}

	app := application.New(application.Options{
		Name:        "Pata",
		Description: "Personal task and note workspace",
		Services: []application.Service{
			application.NewService(greetService),
			application.NewService(spikeService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Configure macOS standard application menu
	appMenu := application.DefaultApplicationMenu()
	app.Menu.SetApplicationMenu(appMenu)

	// Create window with MacTitleBarHiddenInset according to macos-native spec
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Pata",
		Width:     1120,
		Height:    740,
		MinWidth:  800,
		MinHeight: 520,
		Mac: application.MacWindow{
			Backdrop: application.MacBackdropTranslucent,
			TitleBar: application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(250, 250, 248),
		URL:              "/",
	})

	err := app.Run()
	if err != nil {
		log.Fatal(err)
	}
}
