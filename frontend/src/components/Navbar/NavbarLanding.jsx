import React from "react";
import { Outlet, Link } from "react-router-dom";
import { Link as ScrollLink } from "react-scroll";
import "./NavbarLanding.css";
import C2Image from "../../images/frogv2.png";
import { Auth } from "aws-amplify";
import { useNavigate } from "react-router-dom";

export default function NavbarLanding() {
  let navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);

  React.useEffect(() => {
    checkUser();
  }, []);

  async function checkUser() {
    try {
      await Auth.currentAuthenticatedUser();
      setIsAuthenticated(true);
    } catch (error) {
      setIsAuthenticated(false);
    }
  }

  const scrollToSection = (sectionId) => {
    navigate("/#" + sectionId);
  };

  /* Commenting in case we want to allow logged in users to come back to the landing page down the line

  async function signOut(event) {
    event.preventDefault();
    try {
      await Auth.signOut();
      console.log("Sign out successfully");
      navigate("/");
    } catch (error) {
      console.log("error signing out: ", error);
    }
  }
  */

  return (
    <>
      <nav className="navbar navbar-expand-lg" id="main-nav">
        <a className="navbar-brand" href="/">
          <img src={C2Image} className="tcu-image" alt="" />
          <span
            style={{
              color: "white",
              justifyContent: "center",
              fontWeight: "bold",
            }}
          >
            ClassifAI
          </span>
        </a>

        <div
          className="collapse navbar-collapse justify-content-end"
          id="navbarCollapse"
        >
          <ul className="navbar-nav">
            {/* It is ingonering if the user logged in or not for now */}
            <>
              {/* menu when user is not signed in */}
              <li className="nav-item">
              <ScrollLink
                  to="home"
                  spy={true}
                  smooth={true}
                  duration={200}
                  onClick={() => scrollToSection("home")}
                  className="nav-link text-light"
                >
                  {" "}
                  Home
                </ScrollLink>
              </li>
              <li className="nav-item">
                <ScrollLink
                  to="features"
                  spy={true}
                  smooth={true}
                  duration={200}
                  onClick={() => scrollToSection("features")}
                  className="nav-link text-light"
                >
                  {" "}
                  Features
                </ScrollLink>
              </li>
              <li className="nav-item">
                <ScrollLink
                  to="about"
                  spy={true}
                  smooth={true}
                  duration={200}
                  onClick={() => scrollToSection("about")}
                  className="nav-link text-light"
                >
                  {" "}
                  About Us{" "}
                </ScrollLink>
              </li>

              <li className="nav-item">
                <Link to="/signup" className="nav-link text-light">
                  {" "}
                  Sign Up{" "}
                </Link>
              </li>

              <li className="nav-item">
                <Link to="/login" className="nav-link text-light">
                  {" "}
                  Login{" "}
                </Link>
              </li>
            </>
          </ul>
        </div>
      </nav>
      <Outlet />
    </>
  );
};

