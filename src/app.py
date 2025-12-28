"""Oil Record Book Tool - Flask Application."""

import os
from dotenv import load_dotenv
from flask import Flask, render_template
from flask_login import LoginManager, login_required, current_user

# Load environment variables from .env file
load_dotenv()

from config import config
from models import db, User
from flask_migrate import Migrate


def create_app(config_name: str | None = None) -> Flask:
    """Application factory."""
    if config_name is None:
        config_name = os.environ.get("FLASK_ENV", "development")

    app = Flask(
        __name__,
        template_folder="../templates",
        static_folder="../static",
    )
    app.config.from_object(config[config_name])

    # Initialize extensions
    db.init_app(app)
    migrate = Migrate(app, db)

    # Configure Flask-Login
    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"
    login_manager.login_message = "Please log in to access this page."
    login_manager.login_message_category = "info"

    @login_manager.user_loader
    def load_user(user_id):
        """Load user by ID for Flask-Login."""
        return User.query.get(int(user_id))

    # Note: db.create_all() removed - use migrations instead

    # Register blueprints
    from routes.api import api_bp

    app.register_blueprint(api_bp, url_prefix="/api")

    # Main routes
    @app.route("/")
    def dashboard():
        """Main dashboard view."""
        return render_template("dashboard.html")

    @app.route("/soundings")
    def weekly_soundings():
        """Weekly soundings entry form."""
        return render_template("soundings.html")

    @app.route("/history")
    def history():
        """View sounding history and ORB entries."""
        return render_template("history.html")

    @app.route("/fuel")
    def fuel_tickets():
        """Daily fuel ticket entry and tracking."""
        return render_template("fuel.html")

    @app.route("/new-hitch")
    def new_hitch():
        """Start new hitch / import baseline."""
        return render_template("new_hitch.html")

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, host="0.0.0.0", port=5001)

